/* Longship in the Drive-Thru: help / paytable overlay (Menu button). Pages: Paytable, Special symbols, Features, Rules.
   Drawn in layout px inside the current view (landscape 1920x1080, portrait 1080x1920). Swipe, arrows, tabs, keys
   (Left/Right, Esc/Space closes). Every number comes from engine.js, so the text follows the code, not the spec. */
(function () {
  'use strict';
  const H = { deps: null, open: false, page: 0, layer: null, view: null };
  const GOLD = 0xf5c64a, BROWN = 0x2a160a, DEEP = 0x1a0d06;
  const TABS_L = ['PAYTABLE', 'SPECIAL SYMBOLS', 'FEATURES', 'GAME RULES'];
  const TABS_P = ['PAYTABLE', 'SPECIALS', 'FEATURES', 'RULES'];

  const title = (size, fill = '#ffd75a') => new PIXI.TextStyle({ fontFamily: 'Lilita One', fontSize: size, fill,
    stroke: { color: '#3a1a0c', width: Math.max(3, Math.round(size * 0.12)), join: 'round' },
    dropShadow: { color: '#140a05', alpha: 0.6, angle: Math.PI / 2, distance: Math.round(size * 0.08), blur: 2 } });
  const body = (size, w, fill = '#f6e7c8') => new PIXI.TextStyle({ fontFamily: 'Oswald', fontSize: size, fill, fontWeight: '400',
    lineHeight: Math.round(size * 1.3), wordWrap: !!w, wordWrapWidth: w || 0, breakWords: true });
  const label = (size, fill = '#ffd75a', w) => new PIXI.TextStyle({ fontFamily: 'Oswald', fontSize: size, fill, fontWeight: '700',
    stroke: { color: '#1a0e08', width: Math.max(2, size / 10) }, wordWrap: !!w, wordWrapWidth: w || 0, align: 'left' });

  H.init = function (deps) { H.deps = deps; };
  H.isOpen = () => H.open;

  function geom(V) {
    return V.orient === 'portrait'
      ? { x: 30, y: 200, w: 1020, h: 1520, cols: 2, wide: false, tabs: TABS_P, tabFont: 30 }
      : { x: 130, y: 50, w: 1660, h: 940, cols: 4, wide: true, tabs: TABS_L, tabFont: 28 };
  }

  /* ------------------------------------------------------------ open / close */
  H.show = function (page = 0) {
    const D = H.deps, V = D.view(); if (!V) return;
    if (H.layer && !H.layer.destroyed) H.layer.destroy({ children: true });
    H.open = true; H.page = page; H.view = V;
    const P = geom(V), L = H.layer = new PIXI.Container(); V.root.addChild(L);
    const dim = new PIXI.Graphics().rect(-3000, -3000, V.W + 6000, V.H + 6000).fill({ color: 0x07040a, alpha: 0.74 });
    dim.eventMode = 'static';   // eats taps: no spins / bets under the overlay
    L.addChild(dim);
    const panel = H.panel = new PIXI.Container(); L.addChild(panel);
    panel.pivot.set(P.x + P.w / 2, P.y + P.h / 2); panel.position.set(P.x + P.w / 2, P.y + P.h / 2);
    // panel body: dark wood, double gold rim, warm top glow
    const g = new PIXI.Graphics();
    g.roundRect(P.x, P.y, P.w, P.h, 36).fill({ color: DEEP, alpha: 0.97 }).stroke({ color: GOLD, width: 7 });
    g.roundRect(P.x + 12, P.y + 12, P.w - 24, P.h - 24, 28).fill({ color: BROWN, alpha: 0.9 }).stroke({ color: 0x8a5a1c, width: 3 });
    g.roundRect(P.x + 12, P.y + 12, P.w - 24, 110, 28).fill({ color: 0x5a3212, alpha: 0.45 });
    panel.addChild(g);
    panel.eventMode = 'static';
    swipe(panel);
    // tabs
    H.tabs = [];
    const tw = (P.w - 60 - (P.tabs.length - 1) * 12) / P.tabs.length;
    P.tabs.forEach((t, i) => {
      const c = new PIXI.Container(); c.position.set(P.x + 30 + i * (tw + 12), P.y + 30);
      const bg = new PIXI.Graphics(); c.addChild(bg);
      const tx = new PIXI.Text({ text: t, style: title(P.tabFont) }); tx.anchor.set(0.5); tx.position.set(tw / 2, 34); c.addChild(tx);
      c.bg = bg; c.tx = tx; c.w = tw;
      tap(c, () => go(i));
      panel.addChild(c); H.tabs.push(c);
    });
    // close X (top-right corner)
    const x = new PIXI.Container(); x.position.set(P.x + P.w - 6, P.y + 6);
    x.addChild(new PIXI.Graphics().circle(0, 0, 38).fill({ color: 0x7a1a12 }).stroke({ color: GOLD, width: 5 })
      .moveTo(-14, -14).lineTo(14, 14).moveTo(14, -14).lineTo(-14, 14).stroke({ color: 0xfff1c8, width: 7, cap: 'round' }));
    tap(x, () => H.close()); panel.addChild(x); H.closeBtn = x;
    // side arrows + page dots
    const arrow = (dir) => {
      const a = new PIXI.Container(); a.position.set(dir < 0 ? P.x + 6 : P.x + P.w - 6, P.y + P.h / 2 + 30);
      a.addChild(new PIXI.Graphics().circle(0, 0, 36).fill({ color: 0x5a3212 }).stroke({ color: GOLD, width: 5 })
        .moveTo(dir * -8, -15).lineTo(dir * 10, 0).lineTo(dir * -8, 15).stroke({ color: 0xffe9a0, width: 7, cap: 'round', join: 'round' }));
      tap(a, () => go(H.page + dir)); panel.addChild(a); return a;
    };
    H.prev = arrow(-1); H.next = arrow(1);
    H.dots = [];
    for (let i = 0; i < P.tabs.length; i++) {
      const d = new PIXI.Graphics(); d.position.set(P.x + P.w / 2 + (i - (P.tabs.length - 1) / 2) * 34, P.y + P.h - 34);
      tap(d, () => go(i)); panel.addChild(d); H.dots.push(d);
    }
    H.content = new PIXI.Container(); panel.addChild(H.content);
    render(0);
    // pop in
    L.alpha = 0; panel.scale.set(0.92);
    D.tween(L, { alpha: 1 }, 180); D.tween(panel.scale, { x: 1, y: 1 }, 320, 'back');
    D.blip(740, 90, 'triangle', 0.06);
  };
  H.close = function () {
    if (!H.open) return;
    H.open = false;
    const L = H.layer; H.layer = null;
    H.deps.blip(520, 80, 'triangle', 0.05);
    if (L && !L.destroyed) H.deps.tween(L, { alpha: 0 }, 160).then(() => { if (!L.destroyed) L.destroy({ children: true }); });
  };
  // the view was rebuilt (orientation change) or the bet changed: redraw on the same page
  H.rerender = function () {
    if (!H.open) return;
    const D = H.deps;
    if (D.view() !== H.view || !H.layer || H.layer.destroyed) { const p = H.page; H.show(p); return; }
    render(0);
  };
  H.key = function (e) {
    if (e.code === 'ArrowLeft') go(H.page - 1);
    else if (e.code === 'ArrowRight') go(H.page + 1);
    else if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') H.close();
  };
  H.go = (i) => go(i);

  function go(i) {
    const n = TABS_L.length; i = (i + n) % n;
    if (i === H.page) return;
    const dir = i > H.page ? 1 : -1;
    H.page = i; H.deps.blip(880 + i * 60, 50, 'sine', 0.05);
    render(dir);
  }
  function tap(c, fn) {
    c.eventMode = 'static'; c.cursor = 'pointer';
    c.on('pointertap', (e) => { e.stopPropagation(); fn(); });
    c.on('pointerover', () => { c.tint = 0xfff2c0; }); c.on('pointerout', () => { c.tint = 0xffffff; });
  }
  function swipe(panel) {
    let sx = null, sy = 0;
    panel.on('pointerdown', (e) => { sx = e.global.x; sy = e.global.y; });
    const end = (e) => {
      if (sx == null) return;
      const s = H.view ? H.view.root.scale.x : 1;
      const dx = (e.global.x - sx) / s, dy = (e.global.y - sy) / s; sx = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) go(H.page + (dx < 0 ? 1 : -1));
    };
    panel.on('pointerup', end); panel.on('pointerupoutside', end);
  }

  /* ------------------------------------------------------------ pages */
  function render(dir) {
    const D = H.deps, V = H.view, P = geom(V);
    H.tabs.forEach((c, i) => {
      const on = i === H.page;
      c.bg.clear().roundRect(0, 0, c.w, 68, 20).fill({ color: on ? 0xc8861e : 0x3a200c, alpha: on ? 1 : 0.9 }).stroke({ color: on ? 0xffe9a0 : 0x8a5a1c, width: on ? 4 : 3 });
      c.tx.style = title(P.tabFont, on ? '#fff6d8' : '#d9b46a');
    });
    H.dots.forEach((d, i) => d.clear().circle(0, 0, i === H.page ? 11 : 8).fill({ color: i === H.page ? GOLD : 0x6a4418 }));
    const old = H.content;
    const c = H.content = new PIXI.Container(); H.panel.addChildAt(c, H.panel.getChildIndex(old));
    const area = { x: P.x + 60, y: P.y + 122, w: P.w - 120, h: P.h - 122 - 66 };
    [pagePays, pageSpecial, pageFeatures, pageRules][H.page](c, area, P, V);
    if (old) {
      if (dir) D.tween(old, { alpha: 0, x: -dir * 80 }, 160).then(() => old.destroyed || old.destroy({ children: true }));
      else old.destroy({ children: true });
    }
    if (dir) { c.alpha = 0; c.x = dir * 80; D.tween(c, { alpha: 1, x: 0 }, 220); }
  }

  const symTex = (id) => PIXI.Assets.get('assets/symbols/' + H.deps.ART[id] + '.png');
  function symSprite(id, size) {
    const sp = new PIXI.Sprite(symTex(id)); sp.anchor.set(0.5);
    sp.scale.set(Math.min(size / sp.texture.width, size / sp.texture.height)); return sp;
  }
  function payMoney(x) { const D = H.deps; return D.money(D.E.winCents(x, Math.round(D.bet() * 100)) / 100); }

  // 1. Paytable: High / Medium / Low, real art, 5/4/3 in money at the current bet (live from the bet)
  function pagePays(c, A, P, V) {
    const D = H.deps, E = D.E;
    const groups = [['HIGH', 'high'], ['MEDIUM', 'mid'], ['LOW', 'low']];
    const head = new PIXI.Text({ text: `Pays per way at the current bet  ·  5 / 4 / 3 of a kind on adjacent reels from the left`, style: body(P.wide ? 22 : 22, A.w, '#d9c39a') });
    head.position.set(A.x, A.y - 2); c.addChild(head);
    // bet stepper (bottom)
    const stepY = A.y + A.h - 40;
    const st = new PIXI.Container(); c.addChild(st);
    const bt = new PIXI.Text({ text: 'BET  ' + D.money(D.bet()), style: title(34) }); bt.anchor.set(0.5); st.addChild(bt);
    const mk = (dir) => {
      const a = new PIXI.Container(); a.position.set(dir * (bt.width / 2 + 46), 0);
      a.addChild(new PIXI.Graphics().circle(0, 0, 26).fill({ color: 0x5a3212 }).stroke({ color: GOLD, width: 4 })
        .moveTo(dir * -6, -11).lineTo(dir * 7, 0).lineTo(dir * -6, 11).stroke({ color: 0xffe9a0, width: 6, cap: 'round', join: 'round' }));
      tap(a, () => D.setBet(dir)); st.addChild(a);
    };
    mk(-1); mk(1);
    st.position.set(A.x + A.w / 2, stepY + 14);
    const top = A.y + 44, bottom = stepY - 24;
    const per = Math.max(...groups.map(([, t]) => E.PAYSYMS.filter((s) => E.TIERS[s] === t).length));
    const cols = Math.min(P.cols, per), rowsPer = Math.ceil(per / cols), rows = 3 * rowsPer, titleH = 46, gap = 12;
    const cardW = (A.w - (cols - 1) * 16) / cols;
    const cardH = Math.min(210, (bottom - top - 3 * titleH - (rows - 3) * gap - 2 * 18) / rows);
    let y = top;
    for (const [name, tier] of groups) {
      const t = new PIXI.Text({ text: name, style: title(34) }); t.position.set(A.x, y); c.addChild(t);
      const line = new PIXI.Graphics().moveTo(A.x + t.width + 18, y + titleH / 2 - 2).lineTo(A.x + A.w, y + titleH / 2 - 2).stroke({ color: 0x8a5a1c, width: 3 });
      c.addChild(line);
      y += titleH;
      const syms = E.PAYSYMS.filter((s) => E.TIERS[s] === tier).reverse();   // highest first
      syms.forEach((s, i) => {
        const row = Math.floor(i / cols), inRow = Math.min(cols, syms.length - row * cols);
        const off = (cols - inRow) * (cardW + 16) / 2;   // centre a short last row
        const cx = A.x + off + (i % cols) * (cardW + 16), cy = y + row * (cardH + gap);
        c.addChild(card(s, cx, cy, cardW, cardH, E));
      });
      y += rowsPer * cardH + (rowsPer - 1) * gap + 18;
    }
  }
  function card(s, x, y, w, h, E) {
    const k = new PIXI.Container(); k.position.set(x, y);
    k.addChild(new PIXI.Graphics().roundRect(0, 0, w, h, 18).fill({ color: 0x3a200c, alpha: 0.85 }).stroke({ color: 0x9a6a24, width: 3 }));
    const img = h - 14, sp = symSprite(s, img); sp.position.set(8 + img / 2, h / 2); k.addChild(sp);
    const tx = 8 + img + 12, tw = w - tx - 12;
    const nm = new PIXI.Text({ text: E.LABELS[s].toUpperCase(), style: label(Math.round(Math.min(24, h * 0.13)), '#ffd75a', tw) });
    nm.position.set(tx, Math.max(6, h * 0.06)); k.addChild(nm);
    const pays = E.PAYTABLE[s];
    const fs = Math.round(Math.min(30, h * 0.16)), lh = fs * 1.22;
    const y0 = Math.max(nm.y + nm.height + 4, h - 10 - 3 * lh);
    [5, 4, 3].forEach((n, i) => {
      const a = new PIXI.Text({ text: String(n), style: label(fs, '#ffb52e') }); a.position.set(tx, y0 + i * lh); k.addChild(a);
      const b = new PIXI.Text({ text: payMoney(pays[n - 3]), style: label(fs, '#fff6d8') }); b.anchor.set(1, 0); b.position.set(w - 14, y0 + i * lh); k.addChild(b);
    });
    return k;
  }

  // sections: [{icon, title, body}] in 1-2 columns, font shrinks until it fits the area
  function sections(c, A, list, cols, fs0) {
    for (let fs = fs0; fs >= 14; fs -= 1) {
      const box = new PIXI.Container();
      const colW = (A.w - (cols - 1) * 44) / cols;
      const per = Math.ceil(list.length / cols);
      let maxH = 0;
      for (let ci = 0; ci < cols; ci++) {
        let y = 0;
        for (const s of list.slice(ci * per, ci * per + per)) {
          const icon = s.icon ? Math.round(fs * 4.2) : 0, tx = icon ? icon + 22 : 0;
          const x0 = ci * (colW + 44);
          const h1 = new PIXI.Text({ text: s.title, style: title(Math.round(fs * 1.3)) }); h1.position.set(x0 + tx, y); box.addChild(h1);
          const b = new PIXI.Text({ text: s.body, style: body(fs, colW - tx) }); b.position.set(x0 + tx, y + h1.height + 2); box.addChild(b);
          const hh = Math.max(icon, h1.height + 2 + b.height);
          if (icon) { const sp = symSprite(s.icon, icon); sp.position.set(x0 + icon / 2, y + icon / 2 + 4); box.addChild(sp); }
          y += hh + Math.round(fs * 1.1);
        }
        maxH = Math.max(maxH, y - Math.round(fs * 1.1));
      }
      if (maxH <= A.h || fs === 14) { box.position.set(A.x, A.y + Math.max(0, (A.h - maxH) / 2) * 0.4); c.addChild(box); return; }
      box.destroy({ children: true });
    }
  }

  // 2. Special symbols
  function pageSpecial(c, A, P) {
    const E = H.deps.E;
    sections(c, A, [
      { icon: 'W', title: E.LABELS.W.toUpperCase(),
        body: 'Lands on reels 2 to 5. Substitutes for every symbol except the Speaker Scatter and the Cash Coin. A Wild counts on every way it completes and clears with the win.' },
      { icon: 'S', title: E.LABELS.S.toUpperCase(),
        body: `Does not pay and does not substitute. At most one per reel; Scatters stay in place through cascades and are counted when the cascade chain ends. 3 or more trigger ${E.FS_AWARD} FREE SPINS. 3 or more during Free Spins add +${E.RETRIGGER} spins.` },
      { icon: 'COIN', title: E.LABELS.COIN.toUpperCase(),
        body: 'Lands on the reels but does not pay and does not substitute. It belongs to the HOLD THE ORDER feature: coming soon.' },
    ], 1, P.wide ? 30 : 32);
  }

  // 3. Features
  function pageFeatures(c, A, P) {
    const E = H.deps.E, mults = E.DIALS.BASE_MULTS.map((m) => m[0]);
    sections(c, A, [
      { icon: 'LONGSHIP', title: 'CASCADES',
        body: 'Winning symbols clear, the rest fall down and new symbols drop in. The new grid is checked again, so one spin can chain win after win.' },
      { icon: 'MEAD', title: 'MEAD METER',
        body: `Every cleared symbol pours mead into the meter, plus a bonus for each chained cascade. The level is kept between spins (per bet). When it is full: MEAD OVERFLOW! The winners and all J, Q, K and A clear, a refill that always wins drops in, and a multiplier from x${mults[0]} to x${mults[mults.length - 1]} is added to the spin multiplier for the rest of that spin. ${E.HEAT_MAX} Overflows in the base game award ${E.FS_AWARD} Free Spins.` },
      { icon: 'NUGGETS', title: 'NUGGET BOX',
        body: 'Sometimes, before a base spin is paid, one symbol that is not part of a win turns into a Nugget Box. It pays like any Nugget Box and can complete a win. One nugget flies into the Mead Meter for an extra splash of mead.' },
      { icon: 'S', title: 'FREE SPINS',
        body: `${E.FS_AWARD} free spins on reels with more Wilds. A smaller Mead Meter starts empty, and every Overflow adds its multiplier to one that lasts the whole feature. MEAD SURGE: once per free spin, when the chain would end, all J, Q, K and A may clear to keep it going. 3+ Scatters: +${E.RETRIGGER} spins.` },
      { icon: 'VMAN', title: 'BUY BONUS',
        body: `${E.BUY_COST}x the bet buys a spin that lands exactly 3 Scatters, so ${E.FS_AWARD} Free Spins are certain. Wins from that spin pay too. A bought spin leaves your Mead Meter as it was.` },
    ], P.wide ? 2 : 1, P.wide ? 24 : 27);
  }

  // 4. Game rules
  function pageRules(c, A, P) {
    const D = H.deps, E = D.E, bets = D.BETS;
    sections(c, A, [
      { title: `${E.WAYS} WAYS`,
        body: `${E.REELS} reels x ${E.ROWS} rows. A win needs the same symbol on adjacent reels starting from the leftmost reel, on 3, 4 or 5 reels. Ways = the number of matching symbols on each of those reels multiplied together. Win = pay per way x ways (x the spin multiplier, if any).` },
      { title: 'PAYS',
        body: 'Each symbol pays once per cascade with all its ways; different symbols add up. All cascades in a spin add up. Pays in the paytable are for the current total bet.' },
      { title: 'MAX WIN',
        body: `${E.MAX_WIN.toLocaleString('en-US')}x the bet per round (base spin plus its Free Spins). Reaching it ends the round at once.` },
      { title: 'BETS',
        body: `${D.money(bets[0])} to ${D.money(bets[bets.length - 1])}. Big Win from 15x, Mega Win from 40x, Epic Win from 100x the bet.` },
      { title: 'PROTOTYPE',
        body: 'Presentation prototype: the maths is not tuned and no RTP is stated. Malfunction voids all pays and plays.' },
    ], P.wide ? 2 : 1, P.wide ? 26 : 28);
  }

  window.LDTHelp = H;
})();
