/* LONGSHIP IN THE DRIVE-THRU: forked from Lava Aristocrat engine.js (2026-10-31). Only the symbol set,
   paytable and draw weights were reskinned; RTP is NOT re-tuned (prototype). */
/* =========================================================================
   LAVA ARISTOCRAT NIGHT — math engine (single source of truth, no DOM)
   -------------------------------------------------------------------------
   5 reels x 3 rows, 243 ways left to right, CASCADES.
   - A way pays when 3+ ADJACENT reels from reel 1 carry the symbol (or the
     Crystal Pyramid WILD, reels 2-5 only, subs everything but the scatter).
     ways = product of matching cells per reel, pay = PAYTABLE[sym][n-3] per way.
   - Winning cells (all matching cells on the paying reels, wilds included)
     clear, survivors fall, new symbols drop from above (top-first), re-evaluate.
   - Every winning cascade pours lava into the LAVA LAMP (persists across base
     rounds; stateful maths). Full lamp ERUPTS at the end of that step:
       * the eruption melts the step's winners + every lava fragment + every low
         royal (J/Q/K/A); the refill is redrawn until the new grid HAS a win
         (forced cascade; fallbacks below make it unconditional);
       * the galaxy map reveals mapMult (2..10x common, 25x/50x rare); the spin
         multiplier = sum of all mapMults so far in this spin and applies to
         every win from the forced step on;
       * base game: +1 heat pip, HEAT_MAX pips -> 8 free spins (trigger 'lamp').
   - FLOOR WIPE (base only): random event before evaluating the landed grid:
     one non-winning, non-wild, non-scatter cell becomes a LOCK fragment
     (never pays, blocks ways, melts with the next winning cascade) and pours
     FW_BOOST lava into the lamp at once (mini trail).
   - Scatter (Lava Fountain): max 1 per reel, never cleared by cascades, counted
     on the FINAL grid of a spin (where the chain ended). 3/4/5 pay SCATTER_PAYS
     (x bet, times the spin multiplier) and trigger 8 free spins; in free
     spins 3+ retrigger +8.
   - FREE SPINS: own reel tables; a smaller TROPHY meter replaces the lamp
     (fresh at 0 each feature); its eruptions add mapMult to a PERSISTENT
     multiplier (whole feature). LAVA SURGE: when a free-spin chain would end,
     with prob SURGE_P (once per spin) all low royals clear to extend it.
   - 20000x cap on the whole round (base spin + feature); reaching it ends the
     feature at once.
   Buy Bonus: a base spin whose landing is forced to exactly 3 scatters (the
   whole round pays, base spin included), priced at BUY_COST x bet.

   This file is inlined into the game by build.mjs; sim.mjs / tune.mjs /
   check.mjs require() it. Tuning hook: globalThis.LAVA_TUNE (build strips it).
   ========================================================================= */
(function (root) {
  'use strict';

  const T = (typeof globalThis !== 'undefined' && globalThis.LAVA_TUNE) || {};
  const pick = (k, v) => (T[k] !== undefined ? T[k] : v);

  /* ---------------------------------------------------------------- symbols */
  const SYMBOLS = ['J', 'Q', 'K', 'A', 'NUGGETS', 'KETCHUP', 'TRAY', 'MEAD', 'LONGSHIP', 'WSIGN', 'VGIRL', 'VMAN', 'COIN', 'W', 'S'];
  const LOCK = 'LOCK';                        // floor-wipe fragment (no art: drawn by code)
  const WILD = 'W', SCATTER = 'S';
  const LOWS = ['J', 'Q', 'K', 'A'];
  const PAYSYMS = ['J', 'Q', 'K', 'A', 'NUGGETS', 'KETCHUP', 'TRAY', 'MEAD', 'LONGSHIP', 'WSIGN', 'VGIRL', 'VMAN', 'COIN'];
  const LABELS = {
    J: 'J', Q: 'Q', K: 'K', A: 'A',
    NUGGETS: 'Nuggets', KETCHUP: 'Ketchup', TRAY: 'Tray', MEAD: 'Mead',
    LONGSHIP: 'Longship', WSIGN: 'W Sign', VGIRL: 'Viking Girl', VMAN: 'Viking Man', COIN: 'Gold Coin',
    W: 'Battle-Axe WILD', S: 'Drive-Thru SCATTER', LOCK: 'Spilled Mead',
  };
  const TIERS = {
    J: 'low', Q: 'low', K: 'low', A: 'low', NUGGETS: 'mid', KETCHUP: 'mid', TRAY: 'mid', MEAD: 'mid',
    LONGSHIP: 'high', WSIGN: 'high', VGIRL: 'high', VMAN: 'high', COIN: 'high', W: 'wild', S: 'scatter',
  };

  /* ------------------------------------------ paytable, x TOTAL bet per way */
  const PAYTABLE0 = T.paytable || {
    J: [0.2, 0.5, 1.2], Q: [0.2, 0.5, 1.2],
    K: [0.25, 0.7, 1.4], A: [0.25, 0.7, 1.4],
    NUGGETS: [0.5, 1.2, 2.5], KETCHUP: [0.6, 1.3, 3], TRAY: [0.7, 1.4, 3.5], MEAD: [0.8, 1.8, 4.5],
    LONGSHIP: [1.2, 2.5, 7], WSIGN: [1.3, 3, 9], VGIRL: [1.5, 3.5, 12], VMAN: [2, 5, 20], COIN: [2.5, 7, 35],
  };
  const PAY_SCALE = pick('payScale', 1.5);   // tuning only (bake into the table)
  const PAYTABLE = {};
  for (const k of Object.keys(PAYTABLE0)) PAYTABLE[k] = PAYTABLE0[k].map((v) => Math.round(v * PAY_SCALE * 1e4) / 1e4);
  const SCATTER_PAYS = T.scatterPays || { 3: 2, 4: 5, 5: 25 };

  /* ------------------------------------------------- per-reel draw weights
     Independent weighted draw per cell, same table for the landing and for
     the cascade refills of that reel. Max one scatter per reel (enforced at
     draw time). W weight 0 on reel 1 (wild lives on reels 2-5). */
  const BASE_W = T.baseWeights || {
    J: 15, Q: 15, K: 14, A: 14, NUGGETS: 6, KETCHUP: 6, TRAY: 5, MEAD: 5, LONGSHIP: 4, WSIGN: 3, VGIRL: 3, VMAN: 2, COIN: 2,
    W: 0.978, S: 1.6,
  };
  const FS_W = T.fsWeights || {
    J: 10, Q: 10, K: 10, A: 10, NUGGETS: 7, KETCHUP: 6, TRAY: 6, MEAD: 5, LONGSHIP: 4, WSIGN: 4, VGIRL: 3, VMAN: 3, COIN: 2,
    W: 5.133, S: 1.4,
  };
  /* per-reel scaling of W and S (index = reel) */
  const BASE_WILD_REEL = T.baseWildReel || [0, 1, 1, 1, 1];
  const FS_WILD_REEL = T.fsWildReel || [0, 1, 1, 1, 1];
  const BASE_SCAT_REEL = T.baseScatReel || [1, 1, 1, 1, 1];
  const FS_SCAT_REEL = T.fsScatReel || [1, 1, 1, 1, 1];

  /* -------------------------------------------------------------- the lamp */
  const LAMP_MAX = pick('lampMax', 200);       // base lamp size (lava units)
  const TROPHY_MAX = pick('trophyMax', 12);    // free-spin trophy lamp size
  const HEAT_MAX = 3;                          // eruptions (pips) -> 8 FS
  const SHARD_PER_SYMBOL = pick('shardPerSymbol', 1);   // lava per cleared cell
  const CASCADE_BONUS = pick('cascadeBonus', 2);        // extra lava per chained cascade (step>=1)
  const FW_P = pick('floorWipeP', 0.08);       // floor wipe chance per base spin
  const FW_BOOST = pick('floorWipeBoost', 8);  // lava poured by a floor wipe
  const SURGE_P = pick('surgeP', 0.12);        // lava surge chance when a FS chain would end
  const MAX_ERUPT = pick('maxEruptPerSpin', 12);   // eruptions per spin (a hard bound that makes every chain end)
  const FS_AWARD = 8;
  const RETRIGGER = 8;
  const MAX_WIN = 20000;

  /* eruption galaxy-map multipliers [value, weight] */
  const BASE_MULTS = T.baseMults || [[2, 30], [3, 26], [4, 18], [5, 14], [10, 9], [25, 2.4], [50, 0.6]];
  const FS_MULTS = T.fsMults || [[2, 34], [3, 26], [4, 16], [5, 13], [10, 9], [25, 1.6], [50, 0.4]];

  const BUY_COST = pick('buyCost', 100);
  /* node sim.mjs 2000000000 --seed=31 (final dials) pooled with five 1e9 runs at base W 0.974..0.98 (each moved to
     W 0.978 by the measured slope): 7e9 rounds, RTP 96.32% +- 0.02; node sim.mjs 40000000 --buy --seed=22 and
     100000000 --buy --seed=21: buy RTP 96.33 / 96.31%. Splits / frequencies from the 2e9 final-dials run. MATH.md has
     the full readout. */
  const RTP_SHEET = { rtp: 0.9632, rtpSE: 0.00022, base: 0.36525, feature: 0.59872, eruption: 0.11176, freeSpins: 0.48696,
                      hit: 0.2495, fsFreq: 196.1, fsScatterFreq: 580.0, fsLampFreq: 296.2, fsAvg: 95.47,
                      eruptionFreq: 98.1, sd: 18.26, maxWinSeen: 20000, buyRtp: 0.9632, rounds: 7000000000,
                      label: '96.3%' };

  /* -------------------------------------------------------------------- rng */
  function makeRng(seed) {                    // mulberry32 (game UI)
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRngWide(seed) {                // xoshiro128** seeded by splitmix32 (sims)
    let x = seed >>> 0;
    const sm = () => {
      x = (x + 0x9E3779B9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
      z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    let a = sm(), b = sm(), c = sm(), d = sm();
    if ((a | b | c | d) === 0) a = 1;
    return function () {
      const r = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)), 9) >>> 0;
      const t = b << 9;
      c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
      d = (d << 11) | (d >>> 21);
      return r / 4294967296;
    };
  }

  /* ------------------------------------------------------------- tables */
  function makeTable(w, noScatter) {
    const syms = [], cum = [];
    let tot = 0;
    for (const s of SYMBOLS) {
      const v = (noScatter && s === SCATTER) ? 0 : (w[s] || 0);
      if (v <= 0) continue;
      tot += v; syms.push(s); cum.push(tot);
    }
    return { syms, cum, tot };
  }
  function reelTables(w, wildReel, scatReel) {
    return [0, 1, 2, 3, 4].map((r) => {
      const rw = Object.assign({}, w, { W: w.W * wildReel[r], S: w.S * scatReel[r] });
      return { all: makeTable(rw, false), noS: makeTable(rw, true), weights: rw };
    });
  }
  const TABLES = {
    base: reelTables(BASE_W, BASE_WILD_REEL, BASE_SCAT_REEL),
    fs: reelTables(FS_W, FS_WILD_REEL, FS_SCAT_REEL),
  };
  function draw(rng, t) {
    const x = rng() * t.tot, cum = t.cum;
    for (let i = 0; i < cum.length; i++) if (x < cum[i]) return t.syms[i];
    return t.syms[t.syms.length - 1];
  }
  function drawMult(rng, list) {
    let tot = 0;
    for (const e of list) tot += e[1];
    let x = rng() * tot;
    for (const e of list) { if (x < e[1]) return e[0]; x -= e[1]; }
    return list[list.length - 1][0];
  }

  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const cloneGrid = (g) => g.map((c) => c.slice());

  /* ---------------------------------------------------------- evaluation */
  function evaluate(g) {
    const wins = [];
    let total = 0;
    const seen = {};
    for (let y = 0; y < 3; y++) {
      const s = g[0][y];
      if (seen[s] || PAYTABLE[s] === undefined) continue;
      seen[s] = true;
      let ways = 1, n = 0;
      const cells = [];
      for (let r = 0; r < 5; r++) {
        let c = 0;
        for (let yy = 0; yy < 3; yy++) {
          const v = g[r][yy];
          if (v === s || v === WILD) { c++; cells.push([r, yy]); }
        }
        if (!c) break;
        ways *= c; n++;
      }
      if (n < 3) continue;
      while (cells.length && cells[cells.length - 1][0] >= n) cells.pop();
      const pay = PAYTABLE[s][n - 3];
      const x = r4(pay * ways);
      total += x;
      wins.push({ sym: s, reels: n, ways, pay, x, cells });
    }
    return { wins, total: r4(total) };
  }
  function hasWin(g) {
    for (let y = 0; y < 3; y++) {
      const s = g[0][y];
      if (PAYTABLE[s] === undefined) continue;
      let ok = true;
      for (let r = 1; r < 3 && ok; r++) {
        ok = false;
        for (let yy = 0; yy < 3; yy++) { const v = g[r][yy]; if (v === s || v === WILD) { ok = true; break; } }
      }
      if (ok) return true;
    }
    return false;
  }
  function cellsOf(g, pred) {
    const out = [];
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) if (pred(g[r][y])) out.push([r, y]);
    return out;
  }
  const scatterCells = (g) => cellsOf(g, (v) => v === SCATTER);

  /* ------------------------------------------------------ landing / drops */
  function landGrid(rng, tabs, forceScat) {
    const g = [];
    let sReels = null;
    if (forceScat) {
      const reels = [0, 1, 2, 3, 4];
      for (let i = 4; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = reels[i]; reels[i] = reels[j]; reels[j] = t; }
      sReels = reels.slice(0, Math.min(5, forceScat));
    }
    for (let r = 0; r < 5; r++) {
      const col = [];
      if (sReels) {
        for (let y = 0; y < 3; y++) col.push(draw(rng, tabs[r].noS));
        if (sReels.indexOf(r) >= 0) col[Math.floor(rng() * 3)] = SCATTER;
      } else {
        let hasS = false;
        for (let y = 0; y < 3; y++) {
          const s = draw(rng, hasS ? tabs[r].noS : tabs[r].all);
          if (s === SCATTER) hasS = true;
          col.push(s);
        }
      }
      g.push(col);
    }
    return g;
  }
  /* removedMask[r][y] -> drops per reel (top-first) honouring max 1 scatter per reel */
  function makeDrops(rng, g, mask, tabs) {
    const drops = [];
    for (let r = 0; r < 5; r++) {
      let k = 0, hasS = false;
      for (let y = 0; y < 3; y++) { if (mask[r][y]) k++; else if (g[r][y] === SCATTER) hasS = true; }
      const d = [];
      for (let i = 0; i < k; i++) {
        const s = draw(rng, hasS ? tabs[r].noS : tabs[r].all);
        if (s === SCATTER) hasS = true;
        d.push(s);
      }
      drops.push(d);
    }
    return drops;
  }
  function applyGravity(g, mask, drops) {
    const out = [];
    for (let r = 0; r < 5; r++) {
      const keep = [];
      for (let y = 0; y < 3; y++) if (!mask[r][y]) keep.push(g[r][y]);
      out.push(drops[r].concat(keep));
    }
    return out;
  }
  function maskOf(cells) {
    const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const c of cells) m[c[0]][c[1]] = 1;
    return m;
  }
  function maskCells(m) {
    const out = [];
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) if (m[r][y]) out.push([r, y]);
    return out;
  }

  /* Forced cascade (eruption): returns {mask, drops, gridAfter} whose gridAfter
     always holds a win.
       1. melt mask = step winners + LOCK + low royals; redraw the refill up to 40x
       2. melt every non-scatter cell; redraw the whole refill up to 200x
       3. (never seen in 10^8 trials) same full melt with A,A,A dropped on top of reels 1-3 */
  const FALLBACKS = [0, 0, 0];   // QA counter: forced refills resolved by step 1 / 2 / 3
  function forcedRefill(rng, g, mask, tabs) {
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) {
      const v = g[r][y];
      if (v === LOCK || LOWS.indexOf(v) >= 0) mask[r][y] = 1;
    }
    let any = false;
    for (let r = 0; r < 5 && !any; r++) for (let y = 0; y < 3; y++) if (mask[r][y]) { any = true; break; }
    if (any) {
      for (let t = 0; t < 40; t++) {
        const drops = makeDrops(rng, g, mask, tabs);
        const ga = applyGravity(g, mask, drops);
        if (hasWin(ga)) return { mask, drops, gridAfter: ga, fallback: 0 };
      }
    }
    const full = [];
    for (let r = 0; r < 5; r++) full.push([0, 1, 2].map((y) => (g[r][y] === SCATTER ? 0 : 1)));
    for (let t = 0; t < 200; t++) {
      const drops = makeDrops(rng, g, full, tabs);
      const ga = applyGravity(g, full, drops);
      if (hasWin(ga)) return { mask: full, drops, gridAfter: ga, fallback: 1 };
    }
    const drops = makeDrops(rng, g, full, tabs);
    for (let r = 0; r < 3; r++) drops[r][0] = 'A';
    return { mask: full, drops, gridAfter: applyGravity(g, full, drops), fallback: 2 };
  }

  /* QA-ONLY{ ------------------------------------------------ QA custom combinations (force.grid / drops / mapMult)
     Everything between the QA-ONLY markers is QA tooling: build.mjs deletes it from the release page (the -qa page and
     node keep it). None of it runs, or draws a random number, unless a force option asks for it, so the unforced maths
     (and every seeded result) is identical with or without it.
       force.grid     [reel][row] 5x3 of SYMBOLS ids (W, S included): the base spin LANDS exactly this grid (no RNG);
                      cascades / refills after it come from the RNG, every rule applies (wins, lamp, eruption, floor
                      wipe, scatters -> free spins). Rules checked by validateGrid(): max one scatter per reel, wild
                      only on reels whose reel table can draw it (reels 2-5). force.override = true skips those two
                      rules (the engine copes: a W on reel 1 never starts a way, it only fills; a 2nd scatter on a reel
                      counts as one more scatter and is never cleared) - QA-only states the real game never shows.
       force.drops    [reel][i] top-first symbols that drop in on the FIRST step that removes cells (null / '' / missing
                      = RNG). Wrong lengths are fine: extra entries are ignored, missing ones drawn. A forced drop that
                      breaks the scatter / wild rule is replaced by an RNG draw (unless override). On an eruption step
                      the forced drops replace the eruption refill only if the result HAS a win (the eruption's
                      guaranteed win); otherwise the engine's own refill is used (step.qaDropsIgnored = true).
       force.mapMult  value (2,3,4,5,10,25,50) the galaxy map shows on the first eruption of the base spin.
       force.noFloorWipe  no random Floor Wipe on this spin (the custom grid stays exactly as built).
     Combinable with force.eruption / force.floorWipe and with a preset lamp / heat (the page's setLamp). */
  const MAP_VALUES = BASE_MULTS.map((e) => e[0]);
  function validateGrid(g, override) {
    const errs = [];
    if (!Array.isArray(g) || g.length !== 5) return ['grid must be 5 reels'];
    for (let r = 0; r < 5; r++) {
      const c = g[r];
      if (!Array.isArray(c) || c.length !== 3) { errs.push(`reel ${r + 1} must have 3 rows`); continue; }
      for (let y = 0; y < 3; y++) if (SYMBOLS.indexOf(c[y]) < 0) errs.push(`reel ${r + 1} row ${y + 1}: unknown symbol ${JSON.stringify(c[y])}`);
      if (override) continue;
      if (c.filter((v) => v === SCATTER).length > 1) errs.push(`reel ${r + 1}: max one scatter per reel`);
      if (c.indexOf(WILD) >= 0 && !(TABLES.base[r].weights.W > 0)) errs.push(`reel ${r + 1}: no wild on this reel (wild lives on reels 2-5)`);
    }
    return errs;
  }
  function checkForce(force) {
    const errs = [];
    if (force.grid) errs.push(...validateGrid(force.grid, force.override));
    if (force.drops != null) {
      if (!Array.isArray(force.drops) || force.drops.length > 5) errs.push('drops must be an array of up to 5 reels');
      else force.drops.forEach((d, r) => { if (d != null && !Array.isArray(d)) errs.push(`drops reel ${r + 1} must be an array`);
        else (d || []).forEach((v) => { if (v != null && v !== '' && SYMBOLS.indexOf(v) < 0) errs.push(`drops reel ${r + 1}: unknown symbol ${JSON.stringify(v)}`); }); });
    }
    if (force.mapMult != null && MAP_VALUES.indexOf(+force.mapMult) < 0) errs.push(`mapMult must be one of ${MAP_VALUES.join(', ')}`);
    if (errs.length) throw new Error('QA force rejected: ' + errs.join('; '));
  }
  /* drops for a mask with the forced symbols first (RNG for the rest) */
  function forcedDrops(rng, g, mask, tabs, fd, loose) {
    const drops = [];
    for (let r = 0; r < 5; r++) {
      let k = 0, hasS = false;
      for (let y = 0; y < 3; y++) { if (mask[r][y]) k++; else if (g[r][y] === SCATTER) hasS = true; }
      const d = [], want = fd[r] || [];
      for (let i = 0; i < k; i++) {
        let s = want[i];
        if (!s || (!loose && ((s === SCATTER && hasS) || (s === WILD && !(tabs[r].weights.W > 0))))) s = draw(rng, hasS ? tabs[r].noS : tabs[r].all);
        if (s === SCATTER) hasS = true;
        d.push(s);
      }
      drops.push(d);
    }
    return drops;
  }
  /* eruption refill with forced drops: the step-1 melt mask of forcedRefill(); null when the result has no win */
  function forcedRefillQA(rng, g, mask0, tabs, fd, loose) {
    const mask = mask0.map((c) => c.slice());
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) {
      const v = g[r][y];
      if (v === LOCK || LOWS.indexOf(v) >= 0) mask[r][y] = 1;
    }
    const drops = forcedDrops(rng, g, mask, tabs, fd, loose);
    const ga = applyGravity(g, mask, drops);
    return hasWin(ga) ? { mask, drops, gridAfter: ga, fallback: 0 } : null;
  }
  /* }QA-ONLY */

  /* ------------------------------------------------------------ one spin
     ctx = { mode:'base'|'fs', meter, multSum, heat }   (mutated)
     returns Spin; ctx.fsAwardBy collects base triggers                      */
  function playSpin(rng, ctx, force) {
    const fs = ctx.mode === 'fs';
    const tabs = fs ? TABLES.fs : TABLES.base;
    const meterMax = fs ? TROPHY_MAX : LAMP_MAX;
    let grid;
    /*QA-ONLY{*/ let qaDrops = force.drops || null, qaMap = +force.mapMult || 0;
    if (force.grid) grid = cloneGrid(force.grid); else /*}QA-ONLY*/ grid = landGrid(rng, tabs, force.scatters || 0);
    let g = cloneGrid(grid);
    const steps = [];
    let pending = [];
    let boost = 0;
    let forcedNext = false;
    let surgeLeft = fs ? 1 : 0;
    const frozen = !!ctx.frozen;               // Buy Bonus spin: the lamp neither fills nor erupts, no floor wipe
    let forceErupt = !!force.eruption && !frozen;
    let spinX = 0, fsAwarded = 0, erupts = 0;

    if (!fs && !frozen && /*QA-ONLY{*/ !(force.noFloorWipe && !force.floorWipe) && /*}QA-ONLY*/ (force.floorWipe || rng() < FW_P)) {
      const ev = evaluate(g);
      const inWin = maskOf([].concat(...ev.wins.map((w) => w.cells)));
      const cand = cellsOf(g, (v) => v !== WILD && v !== SCATTER && v !== LOCK).filter((c) => !inWin[c[0]][c[1]]);
      if (cand.length) {
        const c = cand[Math.floor(rng() * cand.length)];
        g[c[0]][c[1]] = LOCK;
        pending.push({ type: 'floorWipe', cell: [c[0], c[1]] });
        boost = FW_BOOST;
      }
    }

    for (let idx = 0; idx < 500; idx++) {
      const step = { grid: cloneGrid(g), wins: [], scatterWin: null, mult: Math.max(1, ctx.multSum), x: 0,
                     removed: [], drops: [[], [], [], [], []], gridAfter: null, lamp: null, events: pending };
      if (forcedNext) step.forced = true;
      forcedNext = false;
      pending = [];
      const ev = evaluate(g);
      step.wins = ev.wins;
      const mask = maskOf([].concat(...ev.wins.map((w) => w.cells)));
      if (ev.wins.length) for (const c of cellsOf(g, (v) => v === LOCK)) mask[c[0]][c[1]] = 1;
      const cleared = ev.wins.length ? maskCells(mask).length : 0;
      let fill = frozen ? 0 : boost + (ev.wins.length ? cleared * SHARD_PER_SYMBOL + (idx > 0 ? CASCADE_BONUS : 0) : 0);
      boost = 0;
      const before = ctx.meter;
      const after = Math.min(meterMax, before + fill);
      step.lamp = { before, after, max: meterMax, shards: Math.round(fill) };
      ctx.meter = after;
      let waysX = ev.total;

      const erupt = !frozen && erupts < MAX_ERUPT && (after >= meterMax || (forceErupt && idx === 0));
      if (erupt) {
        forceErupt = false;
        erupts++;
        let mm;
        /*QA-ONLY{*/ if (qaMap) { mm = qaMap; qaMap = 0; } else /*}QA-ONLY*/ mm = drawMult(rng, fs ? FS_MULTS : BASE_MULTS);
        ctx.multSum += mm;
        ctx.meter = 0;
        if (!fs) ctx.heat++;
        step.events.push({ type: 'eruption', which: fs ? 'trophy' : 'lamp', mapMult: mm, multAfter: ctx.multSum,
                           heatAfter: ctx.heat, forced: true });
        if (!fs && ctx.heat >= HEAT_MAX) {
          ctx.heat = 0;
          fsAwarded += FS_AWARD;
          ctx.lampTriggers = (ctx.lampTriggers || 0) + 1;
          step.events.push({ type: 'fsTrigger', count: FS_AWARD, by: 'lamp' });
        }
        let fr = null;
        /*QA-ONLY{*/ if (qaDrops) { fr = forcedRefillQA(rng, g, mask, tabs, qaDrops, !!force.override); if (!fr) step.qaDropsIgnored = true; qaDrops = null; } /*}QA-ONLY*/
        if (!fr) fr = forcedRefill(rng, g, mask, tabs);
        FALLBACKS[fr.fallback]++;
        step.removed = maskCells(fr.mask);
        step.drops = fr.drops;
        step.gridAfter = fr.gridAfter;
        forcedNext = true;
      } else if (ev.wins.length) {
        step.removed = maskCells(mask);
        /*QA-ONLY{*/ if (qaDrops) { step.drops = forcedDrops(rng, g, mask, tabs, qaDrops, !!force.override); qaDrops = null; } else /*}QA-ONLY*/ step.drops = makeDrops(rng, g, mask, tabs);
        step.gridAfter = applyGravity(g, mask, step.drops);
      } else {
        const lows = fs && surgeLeft > 0 ? cellsOf(g, (v) => LOWS.indexOf(v) >= 0) : [];
        if (lows.length && rng() < SURGE_P) {
          surgeLeft--;
          const m = maskOf(lows);
          step.events.push({ type: 'lavaSurge', cells: lows });
          step.removed = lows;
          step.drops = makeDrops(rng, g, m, tabs);
          step.gridAfter = applyGravity(g, m, step.drops);
        } else {
          /* chain ends: scatters on the final grid */
          const sc = scatterCells(g);
          if (sc.length >= 3) {
            step.scatterWin = { count: sc.length, x: SCATTER_PAYS[Math.min(5, sc.length)], cells: sc };
            waysX = r4(waysX + step.scatterWin.x);
            if (fs) {
              fsAwarded += RETRIGGER;
              step.events.push({ type: 'retrigger', add: RETRIGGER });
            } else {
              fsAwarded += FS_AWARD;
              ctx.scatterTriggers = (ctx.scatterTriggers || 0) + 1;
              step.events.push({ type: 'fsTrigger', count: FS_AWARD, by: 'scatter' });
            }
          }
          step.x = r4(step.mult * waysX);
          spinX = r4(spinX + step.x);
          step.gridAfter = cloneGrid(g);
          steps.push(step);
          return { grid, steps, totalX: spinX, scatters: sc.length, fsAwarded, multEnd: Math.max(1, ctx.multSum) };
        }
      }
      step.x = r4(step.mult * waysX);
      spinX = r4(spinX + step.x);
      steps.push(step);
      g = step.gridAfter.map((c) => c.slice());
    }
    throw new Error('cascade did not terminate');
  }

  /* ------------------------------------------------------------- one round */
  function newState() { return { lamp: 0, heat: 0 }; }

  function playRoundOnce(rng, state, opts) {
    const force = Object.assign({}, opts.force || {});
    if (opts.buy) force.scatters = 3;
    /*QA-ONLY{*/ checkForce(force); /*}QA-ONLY*/

    const stateBefore = { lamp: state.lamp, heat: state.heat };
    /* a bought round does not touch the player's lamp / heat (frozen: no fill, no eruption, no floor wipe), so the
       Buy Bonus is worth the same whatever the lamp shows */
    const ctx = { mode: 'base', meter: state.lamp, multSum: 0, heat: state.heat, frozen: !!opts.buy };
    const base = playSpin(rng, ctx, force);
    if (!opts.buy) { state.lamp = ctx.meter; state.heat = ctx.heat; }
    let total = base.totalX;
    let feature = null;
    if (base.fsAwarded > 0) {
      const trigger = opts.buy ? 'buy' : (ctx.scatterTriggers ? 'scatter' : 'lamp');
      const fctx = { mode: 'fs', meter: 0, multSum: 0, heat: state.heat };
      let left = base.fsAwarded, retriggers = 0, ftot = 0;
      const spins = [];
      while (left > 0 && total < MAX_WIN) {
        left--;
        const sp = playSpin(rng, fctx, {});
        spins.push(sp);
        ftot = r4(ftot + sp.totalX);
        total = r4(total + sp.totalX);
        if (sp.fsAwarded) { left += sp.fsAwarded; retriggers++; }
      }
      feature = { trigger, awarded: base.fsAwarded, spins, retriggers, totalX: ftot,
                  persistMultEnd: Math.max(1, fctx.multSum) };
    }
    const capped = total > MAX_WIN;
    const totalX = Math.min(MAX_WIN, total);
    const bigWinTier = totalX >= 100 ? 'epic' : totalX >= 40 ? 'mega' : totalX >= 15 ? 'big' : null;
    return { totalX, capped, rawX: total, stateBefore, stateAfter: { lamp: state.lamp, heat: state.heat },
             base, feature, bigWinTier };
  }

  function playRound(rng, state, opts) {
    opts = opts || {};
    state = state || newState();
    const force = opts.force || {};
    if (!force.bigWin) return playRoundOnce(rng, state, opts);
    /* QA: replay from the same entry state until the round is a BIG WIN (>=15x) */
    const f2 = Object.assign({}, force); delete f2.bigWin;
    const o2 = Object.assign({}, opts, { force: f2 });
    let last = null;
    for (let t = 0; t < 30000; t++) {
      const s = { lamp: state.lamp, heat: state.heat };
      /* after 10000 misses help it along with an eruption, after 20000 with a scatter trigger */
      const o3 = t < 10000 ? o2 : Object.assign({}, o2, { force: Object.assign({}, f2, t < 20000 ? { eruption: true } : { scatters: 3 }) });
      last = { r: playRoundOnce(rng, s, o3), s };
      if (last.r.totalX >= 15) break;
    }
    state.lamp = last.s.lamp; state.heat = last.s.heat;
    return last.r;
  }

  function winCents(x, betCents) { return Math.floor(x * betCents + 1e-6); }

  const api = {
    SYMBOLS, LABELS, TIERS, PAYTABLE, SCATTER_PAYS, LOCK, WILD, SCATTER, LOWS, PAYSYMS,
    REELS: 5, ROWS: 3, WAYS: 243, MAX_WIN, MAX_ERUPT, LAMP_MAX, TROPHY_MAX, HEAT_MAX, FS_AWARD, RETRIGGER, BUY_COST,
    RTP_SHEET,
    DIALS: { BASE_W, FS_W, BASE_WILD_REEL, FS_WILD_REEL, BASE_SCAT_REEL, FS_SCAT_REEL, SHARD_PER_SYMBOL,
             CASCADE_BONUS, FW_P, FW_BOOST, SURGE_P, BASE_MULTS, FS_MULTS },
    makeRng, makeRngWide, newState, playRound, winCents, evaluate, hasWin, FALLBACKS,
    /*QA-ONLY{*/ validateGrid, MAP_VALUES, /*}QA-ONLY*/
  };
  root.LavaAristocrat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
