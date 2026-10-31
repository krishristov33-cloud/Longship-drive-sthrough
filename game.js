/* Longship in the Drive-Thru: fast playable prototype.
   Maths / reel engine / paytable / round flow: Lava Aristocrat engine.js (reskinned symbol ids, see engine.js header).
   Art + positions: Aiko's layout_Landscape.json / layout_Portrait.json. Symbols: Spine 4.2 when present, else static PNG. */
(async function () {
  'use strict';
  const E = globalThis.LavaAristocrat;
  // Tray Liner and Shield-Maiden Cashier were removed from the game (2026-10-31): no art, no Spine for them
  const ART = { J: 'J', Q: 'Q', K: 'K', A: 'A', NUGGETS: 'Nuggets', KETCHUP: 'Ketchup', MEAD: 'Mead',
    LONGSHIP: 'Longship', WSIGN: 'W', VMAN: 'VikingMan', COIN: 'Coin', W: 'Wild', S: 'Scatter' };
  const BETS = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const TURBO = 2;   // turbo plays the whole presentation at 2x
  const ROYAL_SCALE = { J: 0.84, Q: 0.84, K: 0.74, A: 0.84 };   // royals read smaller; K's chunky pickle needs extra (Kris)
  const G = { balance: 1000, betIdx: 2, lastWin: 0, busy: false, sfx: true, music: true, sound: true, turbo: false, auto: false,
    autoCount: 0, grid: null, states: {},
    view: null, orient: null, spine: {}, spineStatus: {} };
  window.LDT = G;   // debug handle
  const rng = E.makeRng((Date.now() ^ 0x5bd1e995) >>> 0);

  /* ------------------------------------------------------------ boot */
  const app = new PIXI.Application();
  await app.init({ resizeTo: window, background: '#120d14', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  document.body.appendChild(app.canvas);
  const FX = window.LDTFX; FX.init(app);
  try { await Promise.all([document.fonts.load("40px 'Lilita One'"), document.fonts.load("40px 'Oswald'")]); } catch (e) { /* fonts optional */ }

  const DATA = window.LDT_DATA || null;   // dist build embeds layouts + spine manifest (data.js)
  const LAYOUT = DATA ? DATA.layouts : {
    landscape: await (await fetch('assets/layout/layout_Landscape.json')).json(),
    portrait: await (await fetch('assets/layout/layout_Portrait.json')).json(),
  };
  const base = (p) => p.split('/').pop();
  const urls = new Set();
  const usedLayer = (l) => l.visible !== false && l.group !== 'Symbols' && !/^Txt_/.test(l.name);   // reel symbols + baked text are replaced at runtime
  for (const k in LAYOUT) for (const l of LAYOUT[k].layers) if (usedLayer(l)) urls.add('assets/layers/' + base(l.placed));
  for (const a of Object.values(ART)) urls.add('assets/symbols/' + a + '.png');
  urls.add('assets/fx/nugget.png');   // the loose nugget cut from Aiko's Nuggets art (Nugget Box flight)
  await PIXI.Assets.load([...urls]);
  await loadSpine();
  const Screens = window.LDTScreens;
  await Screens.init({ app, view: () => G.view, tween: (o, to, ms) => tween(o, to, ms), blip: (f) => blip(f, 160, 'triangle', 0.06),
    vikingVisible: (v) => { if (G.view && G.view.viking) G.view.viking.visible = v; },
    onTier: () => { FX.shake(G.view, 12); blip(1200, 220, 'square', 0.05); } }, DATA && DATA.screens);
  G.screens = Screens;
  // Viking rig (Animoto): character/manifest.json; static sprite + code tweens until it exists
  try {
    const cman = DATA ? DATA.character : await fetch('character/manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (cman) await window.LDTViking.load('character/', cman);
  } catch (e) { console.warn('viking', e); }
  G.vikingStatus = () => window.LDTViking.status;
  const Help = window.LDTHelp;
  Help.init({ view: () => G.view, E, ART, BETS, bet: () => bet(), setBet: (d) => setBet(d), money: (v) => money(v),
    tween: (o, to, ms, e) => tween(o, to, ms, e), blip: (f, ms, t, v) => blip(f, ms, t, v) });
  G.help = Help;
  document.getElementById('loading').remove();

  /* ------------------------------------------------------------ spine */
  async function loadSpine() {
    for (const a of Object.values(ART)) G.spineStatus[a] = 'static (no spine files)';
    let man = DATA ? DATA.spineManifest : null;
    if (!man && !DATA) {
      try {
        const r = await fetch('spine/manifest.json', { cache: 'no-store' });
        if (!r.ok) return;
        man = await r.json();
      } catch (e) { return; }
    }
    if (!man) return;
    // Accept {symbols:{Name:{json,atlas,png}}}, {Name:{...}} or [{name|symbol, json, atlas, png}]
    if (Array.isArray(man.cell)) G.spineCell = man.cell;
    let entries = [];
    const src = man.symbols || man;
    if (Array.isArray(src)) entries = src.map((e) => [e.name || e.symbol || e.id, e]);
    else entries = Object.entries(src).filter(([, v]) => v && typeof v === 'object');
    const byLower = {};
    for (const a of Object.values(ART)) byLower[a.toLowerCase()] = a;
    for (const [name, e] of entries) {
      const art = byLower[String(name).toLowerCase()];
      if (!art || !e.json || !e.atlas) continue;
      const sk = 'sk_' + art, at = 'at_' + art;
      try {
        PIXI.Assets.add({ alias: sk, src: 'spine/' + e.json });
        PIXI.Assets.add({ alias: at, src: 'spine/' + e.atlas });
        await PIXI.Assets.load([sk, at]);
        const test = spine.Spine.from({ skeleton: sk, atlas: at });
        const anims = test.skeleton.data.animations.map((x) => x.name);
        const b = boundsOf(test);
        test.destroy();
        G.spine[art] = { sk, at, anims, b };
        G.spineStatus[art] = 'spine (' + anims.join(', ') + ')' + (anims.includes('idle') && anims.includes('win') ? '' : ' MISSING idle/win');
      } catch (err) {
        G.spineStatus[art] = 'static (spine load failed: ' + (err && err.message || err) + ')';
        console.warn('spine', art, err);
      }
    }
  }
  function boundsOf(sp) {
    sp.skeleton.setToSetupPose();
    if (sp.skeleton.data.findAnimation('idle')) { sp.state.setAnimation(0, 'idle', false); sp.state.apply(sp.skeleton); }
    sp.skeleton.updateWorldTransform(spine.Physics.update);
    const r = sp.skeleton.getBoundsRect();
    return { x: r.x, y: r.y, w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  const meterVal = { f: 0 };
  /* ------------------------------------------------------------ tweens */
  const tweens = new Set();
  const EASE = { lin: (t) => t, out: (t) => 1 - Math.pow(1 - t, 3), in: (t) => t * t * t,
    back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); } };
  function tween(obj, to, ms, ease = 'out') {
    return new Promise((res) => {
      const from = {}; for (const k in to) from[k] = obj[k];
      tweens.add({ obj, from, to, ms, t: 0, ease: EASE[ease], res });
    });
  }
  const fast = () => G.turbo || G.holdTurbo;
  const speed = () => (G.qaTimeScale || 1) * (fast() ? TURBO : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / (fast() ? TURBO : 1)));
  app.ticker.add((tk) => {
    const dt = tk.deltaMS * speed();   // turbo x2, QA slow motion
    for (const tw of tweens) {
      tw.t += dt; const k = Math.min(1, tw.t / tw.ms), e = tw.ease(k);
      if (tw.obj.destroyed) { tweens.delete(tw); tw.res(); continue; }
      for (const p in tw.to) tw.obj[p] = tw.from[p] + (tw.to[p] - tw.from[p]) * e;
      if (k >= 1) { tweens.delete(tw); tw.res(); }
    }
    const t = performance.now() / 1000;
    const V = G.view; if (!V) return;
    for (const n of V.pulsing) { if (!n.destroyed) n.scale.set(n.baseScale * (1 + Math.abs(Math.sin(t * 6)) * 0.12)); }
    FX.update(V, Math.min(0.05, dt / 1000), meterVal.f, G.busy);
    if (V.basePos) V.root.position.set(V.basePos.x + V.shakeX * V.root.scale.x, V.basePos.y + V.shakeY * V.root.scale.y);
  });

  /* ------------------------------------------------------------ sound (tiny WebAudio blips) */
  let ac = null;
  function blip(freq, ms = 90, type = 'triangle', vol = 0.08) {
    if (!G.sfx) return;
    try {
      ac = ac || new AudioContext();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
      o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000);
    } catch (e) { /* audio optional */ }
  }

  /* ------------------------------------------------------------ music (Aiko's track, assets/music/longship_bgm.mp3) */
  // nothing is fetched or decoded until the first tap (mobile memory: the page must stay light at boot)
  const bgm = new Audio();
  bgm.loop = true; bgm.volume = 0.45; bgm.preload = 'none';
  G.bgm = bgm;
  function syncMusic() {
    if (G.music && G.gestured) {
      if (!bgm.src) bgm.src = 'assets/music/longship_bgm.mp3';
      const p = bgm.play(); if (p && p.catch) p.catch(() => {});
    }
    else bgm.pause();
  }
  G.syncMusic = syncMusic;
  const firstGesture = () => {   // browsers only allow audio after a click / key / touch
    G.gestured = true; syncMusic();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, firstGesture, true);
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, firstGesture, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) bgm.pause(); else syncMusic(); });

  /* ------------------------------------------------------------ view build */
  const TXT = (size, fill = '#ffd75a', family = 'Oswald') => new PIXI.TextStyle({ fontFamily: family, fontSize: size, fill,
    stroke: { color: '#1a0e08', width: Math.max(2, size / 9) }, fontWeight: '700' });

  function buildView(orient) {
    const L = LAYOUT[orient];
    const root = new PIXI.Container();
    const V = { orient, root, W: L.W, H: L.H, pulsing: new Set(), cells: [], texts: {} };
    // reel geometry from the Symbols group (Sym_r{row}c{col}_Name)
    const cx = [[], [], [], [], []], cy = [[], [], []];
    for (const l of L.layers) {
      const m = /^Sym_r(\d)c(\d)_[A-Za-z]+$/.exec(l.name);   // ignore duplicates like 'Sym_r1c3_K copy'
      if (m) { cy[m[1] - 1].push(l.y + l.h / 2); cx[m[2] - 1].push(l.x + l.w / 2); }
    }
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    V.cx = cx.map(avg); V.cy = cy.map(avg);
    V.colW = (V.cx[4] - V.cx[0]) / 4; V.rowH = (V.cy[2] - V.cy[0]) / 2;
    V.symW = V.colW * 0.86; V.symH = V.rowH * 0.86;
    const back = L.layers.find((l) => l.name === 'Reel_Back');
    V.win = { x: back.x + 8, y: back.y + 6, w: back.w - 16, h: back.h - 12 };

    let reelsAdded = false;
    for (const l of L.layers) {
      if (l.visible === false) continue;
      if (l.group === 'Symbols') {
        if (!reelsAdded) {
          reelsAdded = true;
          V.hl = new PIXI.Container(); root.addChild(V.hl);
          V.reels = new PIXI.Container(); root.addChild(V.reels);
          const mask = new PIXI.Graphics().rect(V.win.x, V.win.y, V.win.w, V.win.h).fill(0xffffff);
          root.addChild(mask); V.reels.mask = mask;
        }
        continue;
      }
      if (/^Txt_/.test(l.name)) { addText(V, l); continue; }   // live text replaces the baked text art
      const sp = new PIXI.Sprite(PIXI.Assets.get('assets/layers/' + base(l.placed)));
      sp.anchor.set(0.5); sp.position.set(l.x + l.w / 2, l.y + l.h / 2);
      sp.width = l.w; sp.height = l.h; sp.baseScale = sp.scale.x;
      root.addChild(sp);
      wire(V, l, sp);
    }
    addControls(V);
    V.fx = new PIXI.Container(); root.addChild(V.fx);
    V.banner = new PIXI.Text({ text: '', style: TXT(orient === 'portrait' ? 84 : 96, '#ffd75a', 'Lilita One') });
    V.banner.anchor.set(0.5); V.banner.position.set(V.win.x + V.win.w / 2, V.win.y + V.win.h / 2); V.banner.alpha = 0;
    root.addChild(V.banner);
    V.toast = new PIXI.Text({ text: '', style: TXT(40, '#ffffff') });
    V.toast.anchor.set(0.5); V.toast.position.set(V.win.x + V.win.w / 2, V.win.y - 28); V.toast.alpha = 0;
    root.addChild(V.toast);
    FX.build(V, L);
    V.screenLayer = new PIXI.Container(); root.addChild(V.screenLayer);   // Aiko's splash / win screens
    return V;
  }

  /* ---------------- Sound / Turbo / Auto row (code-drawn in the sound button's style; no art for Auto / Turbo yet) */
  const CTRL = { landscape: { y: 905, xs: [1682, 1772, 1862], d: 80 }, portrait: { y: 1642, xs: [742, 862, 982], d: 84 } };
  function roundBtn(V, x, y, d, drawIcon) {
    const c = new PIXI.Container(); c.position.set(x, y);
    const r = d / 2;
    const ring = new PIXI.Graphics().circle(0, 0, r + 6).fill({ color: 0xffc23a, alpha: 0 }); c.addChild(ring);
    c.addChild(new PIXI.Graphics().circle(0, 0, r).fill(0x2a120a).circle(0, 0, r - 5).fill(0x6e1f19)
      .circle(0, -2, r - 9).fill(0x9a3027).ellipse(0, -r * 0.45, r * 0.55, r * 0.22).fill({ color: 0xffffff, alpha: 0.08 }));
    const icon = new PIXI.Container(); c.addChild(icon);
    c.draw = (on) => { icon.removeChildren().forEach((n) => n.destroy()); drawIcon(icon, r, on ? 0xffd75a : 0xead6b4, on); };
    c.setOn = (on) => { c.on_ = on; c.draw(on); ring.alpha = on ? 1 : 0; };
    c.ring = ring; c.baseScale = 1;
    c.draw(false);
    V.root.addChild(c);
    return c;
  }
  function addControls(V) {
    const P = CTRL[V.orient];
    if (V.sfxBtn) {   // the single sound button moves to the end of the row
      const s = (P.d / V.sfxBtn.texture.width); V.sfxBtn.position.set(P.xs[2], P.y); V.sfxBtn.scale.set(s); V.sfxBtn.baseScale = s;
    }
    V.turboBtn = roundBtn(V, P.xs[1], P.y, P.d, (ic, r, col) => {   // lightning bolt
      const k = r / 40;
      ic.addChild(new PIXI.Graphics().poly([4, -26, -14, 4, -1, 4, -6, 26, 14, -6, 1, -6, 6, -26].map((v) => v * k)).fill(col)
        .stroke({ color: 0x2a120a, width: 2 }));
    });
    button(V.turboBtn, () => { G.turbo = !G.turbo; blip(G.turbo ? 1200 : 700, 90, 'square', 0.05); refresh(); toast(G.turbo ? 'TURBO ON' : 'TURBO OFF', 900); });
    V.autoBtn = roundBtn(V, P.xs[0], P.y, P.d, (ic, r, col, on) => {   // circular arrows + AUTO / STOP
      const k = r / 40;
      const g = new PIXI.Graphics();
      g.arc(0, 0, 25 * k, -2.6, 0.3).stroke({ color: col, width: 5 * k, cap: 'round' });
      g.arc(0, 0, 25 * k, 0.55, 2.9).stroke({ color: col, width: 5 * k, cap: 'round' });
      g.poly([25 * k * Math.cos(0.3) + 7 * k, 25 * k * Math.sin(0.3) - 6 * k, 25 * k * Math.cos(0.3) - 7 * k, 25 * k * Math.sin(0.3) - 2 * k,
        25 * k * Math.cos(0.3) + 2 * k, 25 * k * Math.sin(0.3) + 9 * k]).fill(col);
      ic.addChild(g);
      const t = new PIXI.Text({ text: on ? 'STOP' : 'AUTO', style: new PIXI.TextStyle({ fontFamily: 'Lilita One', fontSize: Math.round(15 * k), fill: col,
        stroke: { color: 0x2a120a, width: 3 } }) });
      t.anchor.set(0.5); ic.addChild(t);
    });
    button(V.autoBtn, () => (G.auto ? stopAuto() : startAuto()));
  }
  /* hold the Spin button (> 0.45 s): turbo spins back to back until it is released; a tap is still one spin */
  const HOLD_MS = 450;
  function spinHold(sp) {
    let timer = null, down = false;
    sp.on('pointerdown', () => {
      down = true; clearTimeout(timer);
      if (G.auto) return;                                   // the tap stops autospin instead
      timer = setTimeout(() => { if (down && !G.holding) { G.holding = true; G.holdTurbo = true; refresh(); toast('TURBO HOLD', 700); holdLoop(); } }, HOLD_MS);
    });
    const up = () => {
      down = false; clearTimeout(timer);
      if (G.holding) { G.holding = false; G.holdTurbo = false; sp.skipTap = true; refresh(); }
    };
    sp.on('pointerup', up); sp.on('pointerupoutside', up);
  }
  async function holdLoop() {
    while (G.holding) {
      if (G.busy || Screens.isOpen() || Help.isOpen()) { await wait(80); continue; }
      if (G.balance + 1e-9 < bet()) { toast('Not enough balance'); break; }
      await spin(false, true);
    }
  }
  G.qaHold = (on) => { if (on) { G.holding = true; G.holdTurbo = true; refresh(); holdLoop(); } else { G.holding = false; G.holdTurbo = false; refresh(); } };
  function toggleSound() {
    G.sound = !G.sound; G.sfx = G.sound; G.music = G.sound;
    syncMusic(); refresh(); blip(660);
  }
  G.toggleSound = toggleSound;
  /* autospin: tap to start, tap again (or Spin / Space) to stop; stops on low balance or when help opens */
  function startAuto() {
    if (G.auto || Screens.isOpen() || Help.isOpen()) return;
    G.auto = true; G.autoCount = 0; refresh(); blip(900, 80, 'square', 0.05);
    autoLoop();
  }
  function stopAuto() {
    if (!G.auto) return;
    G.auto = false; refresh(); blip(500, 80, 'square', 0.05);
    if (G.view) toast('AUTOSPIN OFF', 900);
  }
  G.startAuto = startAuto; G.stopAuto = stopAuto;
  async function autoLoop() {
    while (G.auto) {
      if (Help.isOpen()) { stopAuto(); break; }
      if (G.busy || Screens.isOpen()) { await wait(150); continue; }
      if (G.balance + 1e-9 < bet()) { stopAuto(); toast('Not enough balance'); break; }
      G.autoCount++;
      await spin(false, true);
      if (G.auto) await wait(350);
    }
  }

  function addText(V, l) {
    const size = Math.round(l.h * 0.95);
    const t = new PIXI.Text({ text: '', style: TXT(size) });
    const key = l.name.slice(4);
    if (key === 'Bet') { t.anchor.set(0.5); t.position.set(l.x + l.w / 2, l.y + l.h / 2); }
    else if (key === 'LastWin') { t.anchor.set(1, 0.5); t.position.set(l.x + l.w, l.y + l.h / 2); }
    else { t.anchor.set(0, 0.5); t.position.set(l.x, l.y + l.h / 2); }
    V.root.addChild(t); V.texts[key] = t;
  }

  function button(sp, fn) {
    sp.eventMode = 'static'; sp.cursor = 'pointer';
    sp.on('pointertap', fn);
    sp.on('pointerover', () => { sp.tint = 0xfff2c0; });
    sp.on('pointerout', () => { sp.tint = 0xffffff; sp.scale.set(sp.baseScale); });
    sp.on('pointerdown', () => { sp.scale.set(sp.baseScale * 0.92); });
    sp.on('pointerup', () => { tween(sp.scale, { x: sp.baseScale, y: sp.baseScale }, 220, 'back'); });
    sp.on('pointerupoutside', () => { sp.scale.set(sp.baseScale); });
  }
  function wire(V, l, sp) {
    switch (l.name) {
      case 'Background': V.bgSprite = sp; V.bgLayer = l; break;
      case 'Reel_Frame': V.frameSprite = sp; V.frameLayer = l; break;
      case 'Logo': V.logo = sp; V.logoLayer = l; break;
      case 'Viking': V.viking = sp; V.vikingLayer = l; sp.anchor.set(0.5, 1); sp.position.set(l.x + l.w / 2, l.y + l.h); break;
      case 'Spin_Button': V.spinBtn = sp; V.spinIcon = sp; button(sp, () => { if (sp.skipTap) { sp.skipTap = false; return; } spin(false); }); spinHold(sp); break;
      case 'Buy_Bonus': button(sp, () => buyFlow()); break;
      case 'Sound_Button_1': V.sfxBtn = sp; button(sp, () => toggleSound()); break;
      case 'Sound_Button_2': sp.visible = false; break;   // Kris: one sound button only (its slot holds Auto / Turbo)
      case 'Bet_Arrow_L': button(sp, () => setBet(-1)); break;
      case 'Bet_Arrow_R': button(sp, () => setBet(1)); break;
      case 'Icon_Home': button(sp, () => toast('Home (prototype)')); break;
      case 'Icon_Menu': V.menuBtn = sp; button(sp, () => openHelp()); break;
      case 'Mead_Meter': {
        V.meterSprite = sp;
        V.meter = { x: l.x + l.w * 0.40, y: l.y + l.h * 0.22, w: l.w * 0.22, h: l.h * 0.66 };
        V.meterFill = new PIXI.Graphics();
        V.meterFill.blendMode = 'add';
        V.meterText = new PIXI.Text({ text: '', style: TXT(22, '#ffe9a0') });
        V.meterText.anchor.set(0.5, 0); V.meterText.position.set(l.x + l.w / 2, l.y + l.h + 2); V.meterText.visible = false;
        V.pendingMeter = [V.meterFill, V.meterText];
        break;
      }
    }
    if (V.pendingMeter && l.name === 'Mead_Meter') { V.root.addChild(...V.pendingMeter); }
  }

  /* ------------------------------------------------------------ symbols */
  function makeSym(V, id) {
    const c = new PIXI.Container();
    const art = ART[id], sd = G.spine[art];
    const k = ROYAL_SCALE[id] || 1;   // Kris: royals pay least, so they read smaller
    if (sd) {
      const sp = spine.Spine.from({ skeleton: sd.sk, atlas: sd.at });
      // Animoto authors in landscape layout px with origin = cell centre: scale by cell size, not by bounds
      const s = G.spineCell ? Math.min(V.colW / G.spineCell[0], V.rowH / G.spineCell[1]) : Math.min(V.symW / sd.b.w, V.symH / sd.b.h);
      sp.scale.set(s * k);
      if (sd.anims.includes('idle')) sp.state.setAnimation(0, 'idle', true);
      sp.state.timeScale = 1; sp.state.update(Math.random() * 2);
      c.addChild(sp); c.spine = sp; c.isSpine = true;
    } else {
      const sp = new PIXI.Sprite(PIXI.Assets.get('assets/symbols/' + art + '.png'));
      sp.anchor.set(0.5);
      const s = Math.min(V.symW / sp.texture.width, V.symH / sp.texture.height);
      sp.scale.set(s * k);
      c.addChild(sp);
    }
    c.baseScale = 1; c.symId = id;
    return c;
  }
  function placeGrid(V, grid) {
    for (const col of V.cells) for (const n of col) n && n.destroy({ children: true });
    V.cells = grid.map((col, r) => col.map((id, y) => {
      const n = makeSym(V, id); n.position.set(V.cx[r], V.cy[y]); V.reels.addChild(n); return n;
    }));
  }

  /* ------------------------------------------------------------ layout / orientation */
  function pickOrient() { return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'; }
  function fit() {
    const V = G.view; if (!V) return;
    const s = Math.min(app.screen.width / V.W, app.screen.height / V.H);
    V.root.scale.set(s);
    V.root.position.set((app.screen.width - V.W * s) / 2, (app.screen.height - V.H * s) / 2);
    V.basePos = { x: V.root.position.x, y: V.root.position.y }; V.shakeX = V.shakeX || 0; V.shakeY = V.shakeY || 0;
  }
  function setOrient(o) {
    if (G.view) { G.view.root.destroy({ children: true }); }
    G.orient = o; G.view = buildView(o); app.stage.addChild(G.view.root);
    G.vikingSpine = window.LDTViking.attach(G.view);   // null until Animoto's rig is loaded
    placeGrid(G.view, G.grid); refresh(); fit();
    if (Help.isOpen()) Help.rerender();   // keep the help overlay open across an orientation change
  }
  function onResize() {
    const o = pickOrient();
    if (o !== G.orient && !G.busy && !Screens.isOpen()) setOrient(o); else fit();
  }
  window.addEventListener('resize', () => setTimeout(onResize, 30));

  /* ------------------------------------------------------------ HUD */
  const money = (v) => '$' + v.toFixed(2);
  const bet = () => BETS[G.betIdx];
  const stateFor = () => (G.states[bet()] = G.states[bet()] || E.newState());
  function refresh() {
    const V = G.view; if (!V) return;
    if (V.texts.Balance) V.texts.Balance.text = 'BALANCE: ' + money(G.balance);
    if (V.texts.Bet) V.texts.Bet.text = 'BET ' + money(bet()) + '   |   BUY ' + money(bet() * E.BUY_COST);
    if (V.texts.LastWin) V.texts.LastWin.text = G.lastWin > 0 ? 'WIN ' + money(G.lastWin) : 'LAST WIN';
    if (V.sfxBtn) V.sfxBtn.alpha = G.sound ? 1 : 0.4;
    if (V.turboBtn) V.turboBtn.setOn(G.turbo || !!G.holdTurbo);
    if (V.autoBtn) V.autoBtn.setOn(G.auto);
    const st = stateFor(); setMeter(st.lamp / E.LAMP_MAX, null, !G.busy && !G.meterInit); G.meterInit = true;
  }
  // Mead Meter: the value tweens; fx.js draws the liquid (wobble, bubbles, glow, foam at full)
  function setMeter(frac, label, instant) {
    const f = Math.max(0, Math.min(1, frac));
    if (instant || !G.view) { meterVal.f = f; return; }
    if (f > meterVal.f + 0.001) { FX.whoosh(G.view); whoosh(); }
    tween(meterVal, { f }, 550, 'out');
  }
  function whoosh() {
    if (!G.sfx) return;
    try {
      ac = ac || new AudioContext();
      const n = ac.sampleRate * 0.35, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; bp.type = 'bandpass'; bp.frequency.setValueAtTime(300, ac.currentTime); bp.frequency.exponentialRampToValueAtTime(2200, ac.currentTime + 0.35);
      g.gain.value = 0.12; src.connect(bp).connect(g).connect(ac.destination); src.start();
    } catch (e) { /* audio optional */ }
  }
  /* Viking reactions: one hook so the Spine character (Animoto) can replace the code tweens later.
     events: spin_start (no-op on the rig), spin_start_key (Buy Bonus shout), anticipation, win_small, win_big, scatter_trigger, free_spins_cheer, lose_grumble */
  function vikingEvent(name) {
    const V = G.view; if (!V) return;
    if (G.vikingSpine && G.vikingSpine.play(name)) return;
    if (name === 'win_big' || name === 'free_spins_cheer' || name === 'scatter_trigger') FX.squash(V);
    else if (name === 'win_small') FX.yell(V, 0.7);
    else if (name === 'anticipation') FX.yell(V, 0.4);
  }
  G.vikingEvent = vikingEvent;
  function setBet(d) {
    if (G.busy) return;
    G.betIdx = Math.max(0, Math.min(BETS.length - 1, G.betIdx + d)); blip(520 + G.betIdx * 40, 60); refresh();
    if (Help.isOpen()) Help.rerender();   // paytable values follow the bet live
  }
  function openHelp() {
    if (G.busy || Screens.isOpen() || Help.isOpen()) return;
    stopAuto();
    Help.show(0);
  }
  G.openHelp = openHelp;
  async function toast(msg, ms = 1600) {
    const V = G.view; V.toast.text = msg; V.toast.alpha = 1;
    clearTimeout(toast.t); toast.t = setTimeout(() => { if (G.view && G.view.toast) tween(G.view.toast, { alpha: 0 }, 300); }, ms);
  }
  async function banner(msg, ms = 1300) {
    const V = G.view; const b = V.banner; b.text = msg; b.alpha = 0; b.scale.set(0.5);
    blip(880, 200, 'square', 0.05);
    await Promise.all([tween(b, { alpha: 1 }, 200), tween(b.scale, { x: 1, y: 1 }, 350, 'back')]);
    await wait(ms); await tween(b, { alpha: 0 }, 250);
  }

  /* ------------------------------------------------------------ presentation */
  async function land(grid) {
    const V = G.view, drop = V.win.h + V.rowH;
    const jobs = [];
    // anticipation: 2+ Scatters on the earlier reels -> reels 4-5 glow and slow down
    const scatBefore = (r) => grid.slice(0, r).reduce((n, col) => n + col.filter((x) => x === 'S').length, 0);
    const antic = [3, 4].filter((r) => scatBefore(r) >= 2);
    if (antic.length) vikingEvent('anticipation');
    let extra = 0;
    for (let r = 0; r < 5; r++) {
      const isAntic = antic.includes(r);
      if (isAntic) extra += 900;
      const delay = r * 90 + extra, slow = isAntic ? 1.8 : 1;
      jobs.push((async () => {
        if (isAntic) { await wait(r * 90 + extra - 900); V.anticCols = V.anticCols || new Set(); V.anticCols.add(r); blip(180, 600, 'sawtooth', 0.03); await wait(900); }
        else await wait(delay);
        const old = V.cells[r];
        await Promise.all(old.map((n) => tween(n, { y: n.y + drop }, 220, 'in')));
        old.forEach((n) => n.destroy({ children: true }));
        V.cells[r] = grid[r].map((id, y) => {
          const n = makeSym(V, id); n.position.set(V.cx[r], V.cy[y] - drop); V.reels.addChild(n); return n;
        });
        await Promise.all(V.cells[r].map((n, y) => tween(n, { y: V.cy[y] }, (330 + (2 - y) * 30) * slow, 'back')));
        if (V.anticCols) V.anticCols.delete(r);
        blip(220 + r * 30, 50, 'sine', 0.06);
      })());
    }
    await Promise.all(jobs);
    G.grid = grid.map((c) => c.slice());
  }
  function syncGrid(grid) {   // trust the engine's grid
    const V = G.view;
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) {
      if (V.cells[r][y].symId !== grid[r][y]) {
        V.cells[r][y].destroy({ children: true });
        const n = makeSym(V, grid[r][y]); n.position.set(V.cx[r], V.cy[y]); V.reels.addChild(n); V.cells[r][y] = n;
      }
    }
    G.grid = grid.map((c) => c.slice());
  }
  function highlight(cells) {
    const V = G.view, key = new Set(cells.map(([r, y]) => r + ',' + y));
    V.hl.removeChildren().forEach((c) => c.destroy());
    V.winOn = true;
    const per = Math.max(5, Math.round(60 / Math.max(1, key.size)));
    for (const k of key) { const [r, y] = k.split(',').map(Number); FX.burst(V, V.cx[r], V.cy[y], per); }
    for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) {
      const n = V.cells[r][y], on = key.has(r + ',' + y);
      n.alpha = on ? 1 : 0.45;
      if (!on) continue;
      const g = new PIXI.Graphics().roundRect(V.cx[r] - V.colW / 2 + 6, V.cy[y] - V.rowH / 2 + 6, V.colW - 12, V.rowH - 12, 22)
        .fill({ color: 0xffb020, alpha: 0.18 }).stroke({ color: 0xffd75a, width: 5 });
      V.hl.addChild(g);
      if (n.isSpine && G.spine[ART[n.symId]] && G.spine[ART[n.symId]].anims.includes('win')) n.spine.state.setAnimation(0, 'win', true);
      else V.pulsing.add(n);
    }
  }
  function unhighlight() {
    const V = G.view; V.winOn = false;
    V.hl.removeChildren().forEach((c) => c.destroy());
    for (const n of V.pulsing) if (!n.destroyed) n.scale.set(n.baseScale);
    V.pulsing.clear();
    for (const col of V.cells) for (const n of col) {
      n.alpha = 1;
      if (n.isSpine && G.spine[ART[n.symId]].anims.includes('idle')) n.spine.state.setAnimation(0, 'idle', true);
    }
  }
  async function cascade(step) {
    const V = G.view, gone = new Set(step.removed.map(([r, y]) => r + ',' + y));
    await Promise.all(step.removed.map(([r, y]) => {
      const n = V.cells[r][y];
      return Promise.all([tween(n.scale, { x: 0.05, y: 0.05 }, 260, 'in'), tween(n, { alpha: 0 }, 260)]);
    }));
    blip(330, 120, 'sawtooth', 0.04);
    const moves = [];
    for (let r = 0; r < 5; r++) {
      const keep = [];
      for (let y = 0; y < 3; y++) { const n = V.cells[r][y]; if (gone.has(r + ',' + y)) n.destroy({ children: true }); else keep.push(n); }
      const fresh = (step.drops[r] || []).map((id, i, arr) => {
        const n = makeSym(V, id); n.position.set(V.cx[r], V.cy[0] - V.rowH * (arr.length - i)); V.reels.addChild(n); return n;
      });
      const col = fresh.concat(keep);
      V.cells[r] = col;
      col.forEach((n, y) => moves.push(tween(n, { y: V.cy[y] }, 320, 'back')));
    }
    await Promise.all(moves);
    syncGrid(step.gridAfter);   // trust the engine's grid
  }
  async function playSpin(sp, label) {
    await land(sp.grid);
    vikingEvent('reels_stop');
    let shown = 0, cascades = 0;
    for (const step of sp.steps) {
      for (const ev of step.events || []) if (ev.type === 'floorWipe') await nuggetTransform(ev, step);
      syncGrid(step.grid);
      const cells = [];
      for (const w of step.wins) cells.push(...w.cells);
      if (cells.length) {
        const from = shown; shown += step.x; cascades++;
        highlight(cells);
        if (cascades >= 2) FX.shake(G.view, Math.min(14, 4 + cascades * 2));
        if (!label && cascades === 1) vikingEvent('win_small');
        blip(660, 140, 'triangle', 0.08); setTimeout(() => blip(990, 160), 120);
        const pre = (label ? label + '  ' : '') + (step.mult > 1 ? `x${step.mult}  ` : '') + 'WIN ';
        const cnt = { v: from };
        const cents = (x) => E.winCents(x, Math.round(bet() * 100)) / 100;
        toast(pre + money(cents(from)), 1400);
        const roll = tween(cnt, { v: shown }, 650, 'out');
        const iv = setInterval(() => { if (G.view) G.view.toast.text = pre + money(cents(cnt.v)); }, 30);
        await roll; clearInterval(iv); G.view.toast.text = pre + money(cents(shown));
        await wait(600);
        unhighlight();
      }
      if (step.scatterWin) await scatterShow(step.scatterWin, label);   // Scatters pay nothing: trigger only
      if (step.lamp) setMeter(step.lamp.after / step.lamp.max, null);
      for (const ev of step.events || []) {
        if (ev.type === 'eruption') await banner(`MEAD OVERFLOW!  x${ev.multAfter}`, 900);
        else if (ev.type === 'fsTrigger') vikingEvent('scatter_trigger');          // the fsTrigger screen follows the base spin
        else if (ev.type === 'retrigger') await Screens.show('retrigger', { fields: { FS_add: '+' + ev.add } });
        else if (ev.type === 'lavaSurge') toast('MEAD SURGE!');
      }
      if (step.removed && step.removed.length && step.gridAfter) await cascade(step);
    }
  }
  async function scatterShow(sw, label) {
    highlight(sw.cells);
    blip(520, 160, 'square', 0.05); setTimeout(() => blip(780, 200, 'square', 0.05), 140);
    toast(sw.count + ' SCATTERS: ' + (label ? 'RETRIGGER!' : 'FREE SPINS!'), 1200);
    await wait(1000);
    unhighlight();
  }
  /* Nugget Box transformation (engine floor wipe): golden flash + fry-oil smoke + sparkle ring cover the cell, the
     sprite swaps at peak cover, the new Nugget Box squash-pops (about 0.45 s), then one nugget arcs into the Mead
     Meter and the meter rises only when it lands. Runs before the step is evaluated, so the new symbol can win. */
  async function nuggetTransform(ev, step) {
    const V = G.view, [r, y] = ev.cell, x = V.cx[r], yy = V.cy[y], old = V.cells[r][y];
    blip(1300, 90, 'square', 0.05); setTimeout(() => blip(1950, 140, 'triangle', 0.07), 70);
    if (G.qaNuggetSlow) G.qaTimeScale = G.qaNuggetSlow;
    G.qaNugget = 'puff'; FX.nuggetPuff(V, x, yy, Math.min(V.colW, V.rowH));
    FX.shake(V, 7);
    await Promise.all([tween(old.scale, { x: 1.22, y: 0.72 }, 150, 'out'), tween(old, { alpha: 0.15 }, 150)]);
    if (G.view !== V) return;
    old.destroy({ children: true });                       // peak cover: swap
    const n = makeSym(V, ev.to || 'NUGGETS'); n.position.set(x, yy); n.scale.set(0.35, 0.35); V.reels.addChild(n); V.cells[r][y] = n;
    if (G.grid) G.grid[r][y] = n.symId;
    G.qaNugget = 'pop'; await tween(n.scale, { x: 1.2, y: 0.85 }, 140, 'out');
    await tween(n.scale, { x: 1, y: 1 }, 180, 'back');
    G.qaNugget = 'flight'; await nuggetFlight(V, x, yy);
    G.qaNugget = 'landed'; G.qaTimeScale = 1;
    if (step.lamp) setMeter(Math.min(step.lamp.max, step.lamp.before + (ev.boost || 0)) / step.lamp.max, null);
    await wait(260);
  }
  function nuggetFlight(V, x0, y0) {
    return new Promise((res) => {
      if (!V.meter) { res(); return; }
      const tex = PIXI.Assets.get('assets/fx/nugget.png'), sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5); const s0 = (V.colW * 0.42) / tex.width; sp.scale.set(s0); sp.position.set(x0, y0);
      V.fx.addChild(sp);
      const m = V.meter, x1 = m.x + m.w / 2, y1 = m.y + m.h * (1 - Math.max(0.1, Math.min(0.95, meterVal.f)));
      const cx = (x0 + x1) / 2 + (x1 - x0) * 0.08, cy = Math.min(y0, y1) - V.rowH * 1.3;
      const D = 0.62, spin = (x1 >= x0 ? 1 : -1) * Math.PI * 2.5;
      let t = 0, acc = 0;
      blip(600, 380, 'sine', 0.04);
      const fn = (tk) => {
        if (sp.destroyed || G.view !== V) { app.ticker.remove(fn); if (!sp.destroyed) sp.destroy(); res(); return; }
        t += tk.deltaMS * speed() / 1000;
        const k = Math.min(1, t / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, u = 1 - e;
        sp.x = u * u * x0 + 2 * u * e * cx + e * e * x1; sp.y = u * u * y0 + 2 * u * e * cy + e * e * y1;
        sp.rotation = e * spin;
        sp.scale.set(s0 * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, k * 2.5))) * (1 - 0.68 * e));
        acc += tk.deltaMS * speed();
        while (acc > 14) { acc -= 14; FX.nuggetTrail(V, sp.x, sp.y, 1 - 0.5 * e); }
        if (k >= 1) {
          app.ticker.remove(fn); sp.destroy();
          FX.meterSplash(V, x1, y1); FX.shake(V, 3);
          blip(240, 160, 'sine', 0.09); setTimeout(() => blip(1500, 120, 'triangle', 0.06), 40);
          res();
        }
      };
      app.ticker.add(fn);
    });
  }
  G.debugNugget = () => { G.forceNext = { floorWipe: true }; return spin(false); };   // QA: force a Nugget Box transformation
  function pressFx(sp) {
    if (!sp) return;
    sp.scale.set(sp.baseScale * 0.9); sp.tint = 0xfff6d0;
    tween(sp.scale, { x: sp.baseScale, y: sp.baseScale }, 260, 'back').then(() => { sp.tint = 0xffffff; });
  }
  async function spin(buy, fromAuto) {
    if (G.auto && !fromAuto) { stopAuto(); return; }   // Spin / Space during autospin = stop
    if (!buy && !fromAuto) pressFx(G.view && G.view.spinBtn);
    if (G.busy || Screens.isOpen() || Help.isOpen()) return;
    const cost = buy ? bet() * E.BUY_COST : bet();
    if (G.balance + 1e-9 < cost) { toast('Not enough balance'); return; }
    if (ac && ac.state === 'suspended') ac.resume();
    G.busy = true; G.balance -= cost; G.lastWin = 0; G.spinCount = (G.spinCount || 0) + 1; refresh();
    try {
      const force = G.forceNext || undefined; G.forceNext = null;   // QA hook (e.g. { floorWipe: true })
      const round = E.playRound(rng, stateFor(), { buy, force });
      G.lastRound = round;
      vikingEvent(buy ? 'spin_start_key' : 'spin_start');   // the shout only on key moments; normal spins stay on idles
      await playSpin(round.base);
      if (round.feature) {
        const f = round.feature;
        await Screens.show('fsTrigger', { fields: { FS_count: String(f.awarded || E.FS_AWARD) }, hideViking: true });
        vikingEvent('free_spins_cheer');                 // loops through the free spins
        for (let i = 0; i < f.spins.length; i++) { vikingEvent('spin_start'); await playSpin(f.spins[i], `FS ${i + 1}/${f.spins.length}`); }
        vikingEvent('free_spins_end');
        const fsWin = E.winCents(f.totalX, Math.round(bet() * 100)) / 100;
        await Screens.show('fsOutro', { count: { FS_total: { to: fsWin } }, fields: { FS_spins: `IN ${f.spins.length} FREE SPINS` }, hideViking: true });
      }
      const win = E.winCents(round.totalX, Math.round(bet() * 100)) / 100;
      G.lastWin = win; G.balance += win;
      if (win === 0 && Math.random() < 0.33) vikingEvent('lose_grumble');   // manifest: p = 0.33
      if (round.bigWinTier) {
        vikingEvent('win_big'); FX.shake(G.view, 16);
        const V = G.view; for (let i = 0; i < 10; i++) setTimeout(() => G.view === V && FX.burst(V, V.win.x + Math.random() * V.win.w, V.win.y + Math.random() * V.win.h, 16), i * 120);
      }
      if (round.bigWinTier) await Screens.bigWin(win, bet());
      else if (win > 0) toast('TOTAL WIN ' + money(win), 1400);
    } finally {
      G.busy = false;
      refresh();
      if (pickOrient() !== G.orient) setOrient(pickOrient());
    }
  }
  async function buyFlow() {
    if (G.busy || Screens.isOpen() || Help.isOpen() || G.auto) return;
    const cost = bet() * E.BUY_COST;
    if (G.balance + 1e-9 < cost) { toast('Not enough balance'); return; }
    const r = await Screens.show('buyConfirm', { fields: { Buy_desc: `${E.FS_AWARD} FREE SPINS FOR`, Buy_cost: Screens.money(cost) } });
    if (r === 'Confirm') spin(true);
  }
  G.buyFlow = buyFlow;
  window.addEventListener('keydown', (e) => {
    if (Help.isOpen()) { if (/^(Space|Escape|Enter|ArrowLeft|ArrowRight)$/.test(e.code)) { e.preventDefault(); Help.key(e); } return; }
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (Screens.isOpen()) Screens.key(); else spin(false);
  });

  /* ------------------------------------------------------------ start */
  G.grid = E.playRound(E.makeRng(3), E.newState()).base.grid;   // a cosmetic opening grid
  setOrient(pickOrient());
  G.spinFn = spin;
  G.ready = true;
  Screens.show('intro', { fields: { FS_desc: `3+ SCATTERS = ${E.FS_AWARD} FREE SPINS`, Buy_desc: `INSTANT FEATURE: ${E.BUY_COST}x BET` } });
  console.log('Spine status', G.spineStatus);
})();
