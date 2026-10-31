/* Longship in the Drive-Thru: Aiko's splash / win screens, played from ui_screens_manifest.json.
   Landscape: the manifest's 1920x1080 coordinates as-is. Portrait: the content block is refitted to the screen,
   the backdrop covers the stage and the character group moves under the panel. */
(function () {
  'use strict';
  const R = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (k) => Math.max(0, Math.min(1, k));
  const EASE = {
    backOut: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outCubic: (t) => 1 - Math.pow(1 - t, 3), linear: (t) => t,
  };
  const BASE = 'assets/screens/';
  const SC = { man: null, ready: null, open: null, deps: null };

  SC.init = async function (deps, manifest) {
    SC.deps = deps;
    SC.man = manifest || await (await fetch(BASE + 'ui_screens_manifest.json')).json();
    const urls = (ids) => {
      const s = new Set();
      for (const id of ids) {
        const sc = SC.man.screens[id];
        for (const l of sc.layers) if (!l.sampleOnly) s.add(BASE + l.file);
        for (const e of sc.emitters || []) for (const f of e.sprites) s.add(BASE + f);
      }
      return [...s];
    };
    await PIXI.Assets.load(urls(['intro']));                       // intro first, the rest in the background
    SC.ready = PIXI.Assets.load(urls(Object.keys(SC.man.screens).filter((k) => k !== 'intro')));
  };
  SC.isOpen = () => !!SC.open;

  /* ------------------------------------------------------------ text */
  function numberStyle(f) {
    const nf = Object.assign({}, SC.man.numberFont, f);
    let fill = nf.fillGradient ? nf.fillGradient[1] : '#FFD75A';
    try {
      fill = new PIXI.FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
        colorStops: [{ offset: 0, color: nf.fillGradient[0] }, { offset: 1, color: nf.fillGradient[1] }] });
    } catch (e) { /* solid fallback */ }
    const ds = nf.dropShadow || {};
    return new PIXI.TextStyle({
      fontFamily: nf.font || 'Lilita One', fontSize: f.sizePx, fill, align: f.align || 'center',
      stroke: { color: nf.stroke || '#3A1A0C', width: Math.round(f.sizePx * (nf.strokeWidthRatio || 0.08)), join: 'round' },
      dropShadow: { color: ds.color || '#140A05', alpha: ds.alpha ?? 0.65, angle: Math.atan2(ds.dy ?? 6, ds.dx ?? 0), distance: Math.hypot(ds.dx || 0, ds.dy ?? 6), blur: ds.blur ?? 4 },
    });
  }
  const money = (v) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  SC.money = money;

  /* ------------------------------------------------------------ placement */
  function bboxOf(list) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, w, h] of list) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function transform(sc, V) {
    if (V.orient !== 'portrait') return { s: 1, ox: 0, oy: 0, cs: 1, cox: 0, coy: 0 };
    const content = [], chars = [];
    for (const l of sc.layers) {
      if (l.sampleOnly || l.group === 'Backdrop' || l.group === 'FX') continue;
      (l.group === 'Character' ? chars : content).push([l.x, l.y, l.w, l.h]);
    }
    for (const f of sc.fields || []) content.push([f.center[0] - f.maxWidthPx / 2, f.center[1] - f.sizePx / 2, f.maxWidthPx, f.sizePx]);
    const b = bboxOf(content), W = V.W, H = V.H;
    const s = Math.min((W * 0.94) / b.w, (H * 0.55) / b.h);
    const cx = W / 2, cy = H * 0.40;
    const T = { s, ox: cx - (b.x + b.w / 2) * s, oy: cy - (b.y + b.h / 2) * s };
    if (chars.length) {
      const cb = bboxOf(chars), top = T.oy + (b.y + b.h) * s + 20, room = H - top - 10;
      const cs = Math.max(0.35, Math.min(room / cb.h, (W * 0.8) / cb.w, s * 1.15));
      T.cs = cs; T.cox = W / 2 - (cb.x + cb.w / 2) * cs; T.coy = H - 10 - (cb.y + cb.h) * cs;
    }
    return T;
  }
  const mapPt = (T, char, x, y) => char ? { x: T.cox + x * T.cs, y: T.coy + y * T.cs, s: T.cs } : { x: T.ox + x * T.s, y: T.oy + y * T.s, s: T.s };

  /* ------------------------------------------------------------ build one screen */
  function build(id, V, opts = {}) {
    const sc = SC.man.screens[id], T = transform(sc, V);
    const c = new PIXI.Container(); c.sortableChildren = false;
    const scr = { id, sc, c, T, items: [], fields: {}, t: 0, parts: [], emitters: [], buttons: {}, opts };
    const layers = [...sc.layers].sort((a, b) => a.z - b.z);
    const partLayer = new PIXI.Container();
    for (const l of layers) {
      if (l.sampleOnly) continue;
      const tex = PIXI.Assets.get(BASE + l.file); if (!tex) continue;
      const sp = new PIXI.Sprite(tex), it = { sp, l, anim: l.animate, a: l.opacity ?? 1, press: 1 };
      if (l.group === 'Backdrop') {
        if (/dim/i.test(l.name)) { sp.position.set(0, 0); sp.width = V.W; sp.height = V.H; }
        else { const k = Math.max(V.W / l.w, V.H / l.h); sp.anchor.set(0.5); sp.position.set(V.W / 2, V.H / 2); sp.scale.set(k * l.w / tex.width, k * l.h / tex.height); }
        it.backdrop = true;
        if (opts.instantBackdrop && it.anim && it.anim.type === 'fadeIn') it.anim = null;
      } else {
        const p = mapPt(T, l.group === 'Character', l.anchorPos[0], l.anchorPos[1]);
        sp.anchor.set(l.anchor[0], l.anchor[1]); sp.position.set(p.x, p.y);
        sp.scale.set(p.s * l.w / tex.width, p.s * l.h / tex.height);
        it.s = p.s;
      }
      it.bx = sp.x; it.by = sp.y; it.bsx = sp.scale.x; it.bsy = sp.scale.y; sp.alpha = it.a;
      c.addChild(sp); scr.items.push(it);
      // buttons: the plate is the hit area; the label follows its press scale
      for (const b of sc.buttons || []) {
        if (b.plateLayer === l.name) {
          scr.buttons[b.name] = { plate: it, label: null, def: b };
          sp.eventMode = 'static'; sp.cursor = 'pointer';
          const pressS = (it.anim && it.anim.pressScale) || 0.94;
          sp.on('pointerover', () => { it.press = 1.04; });
          sp.on('pointerout', () => { it.press = 1; });
          sp.on('pointerdown', () => { it.press = pressS; });
          sp.on('pointertap', (e) => { e.stopPropagation(); it.press = 1; finish(scr, b.name); });
        }
        if (b.labelLayer === l.name) setTimeout(() => { if (scr.buttons[b.name]) scr.buttons[b.name].label = it; });
      }
    }
    c.addChild(partLayer); scr.partLayer = partLayer;
    for (const f of sc.fields || []) {
      const t = new PIXI.Text({ text: '', style: numberStyle(f) });
      t.anchor.set(f.anchor ? f.anchor[0] : 0.5, f.anchor ? f.anchor[1] : 0.5);
      const p = mapPt(T, false, f.center[0], f.center[1]); t.position.set(p.x, p.y);
      const it = { sp: t, f, anim: f.anim || null, a: 1, press: 1, s: p.s, field: true, bx: p.x, by: p.y, bsx: p.s, bsy: p.s };
      t.scale.set(p.s); c.addChild(t); scr.items.push(it); scr.fields[f.name] = it;
    }
    for (const e of sc.emitters || []) {
      const em = { e, acc: 0, live: 0, burstDone: false };
      scr.emitters.push(em);
    }
    return scr;
  }
  function setField(scr, name, text) {
    const it = scr.fields[name]; if (!it) return;
    it.sp.text = text;
    const maxW = it.f.maxWidthPx * it.s, w = it.sp.width / Math.max(1e-6, it.sp.scale.x) * it.s;
    const k = w > maxW ? maxW / w : 1;
    it.bsx = it.bsy = it.s * k;
  }

  /* ------------------------------------------------------------ particles */
  function emit(scr, em, V) {
    const e = em.e, T = scr.T, sp = e.spawn;
    const tex = PIXI.Assets.get(BASE + e.sprites[(Math.random() * e.sprites.length) | 0]); if (!tex) return;
    let x, y, ang;
    if (sp.type === 'line') { x = R(0, V.W); y = R(-80, 10); }
    else if (sp.type === 'rect') { const p = mapPt(T, false, R(sp.rect[0], sp.rect[0] + sp.rect[2]), R(sp.rect[1], sp.rect[1] + sp.rect[3])); x = p.x; y = p.y; }
    else if (sp.type === 'circle') { const a = R(0, Math.PI * 2), p = mapPt(T, false, sp.center[0] + Math.cos(a) * sp.radius, sp.center[1] + Math.sin(a) * sp.radius); x = p.x; y = p.y; ang = a; }
    else { const p = mapPt(T, false, sp.at[0], sp.at[1]); x = p.x; y = p.y; }
    if (ang == null) ang = R(e.angleDeg[0], e.angleDeg[1]) * Math.PI / 180;
    const s = T.s, speed = R(e.speed[0], e.speed[1]) * s;
    const p = new PIXI.Sprite(tex); p.anchor.set(0.5); p.position.set(x, y);
    const sc0 = R(e.scale[0], e.scale[1]) * s; p.scale.set(sc0);
    p.v = { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, g: (e.gravity || 0) * s, life: R(e.lifeMs[0], e.lifeMs[1]) / 1000, t: 0,
      spin: e.spinDegPerSec ? R(e.spinDegPerSec[0], e.spinDegPerSec[1]) * Math.PI / 180 : 0, fio: e.alpha === 'fadeInOut' };
    scr.partLayer.addChild(p); scr.parts.push(p); em.live++; p.em = em;
  }
  function stepEmitters(scr, dt, V) {
    for (const em of scr.emitters) {
      const e = em.e;
      if (!em.burstDone && e.burstCount) { for (let i = 0; i < e.burstCount; i++) emit(scr, em, V); em.burstDone = true; }
      if (e.ratePerSec) {
        let active = true;
        if (typeof e.durationMs === 'number') active = e.durationMs === 0 ? false : scr.t * 1000 < e.durationMs;
        else if (typeof e.durationMs === 'string' && e.durationMs.startsWith('whileCountUp')) active = scr.counting || (scr.countEndT != null && scr.t - scr.countEndT < 1.5);
        if (active) {
          em.acc += e.ratePerSec * dt;
          while (em.acc >= 1) { em.acc -= 1; if (!e.maxCount || em.live < e.maxCount) emit(scr, em, V); }
        }
      }
    }
    for (let i = scr.parts.length - 1; i >= 0; i--) {
      const p = scr.parts[i], v = p.v; v.t += dt;
      if (v.t >= v.life) { p.destroy(); scr.parts.splice(i, 1); p.em.live--; continue; }
      v.vy += v.g * dt; p.x += v.vx * dt; p.y += v.vy * dt; p.rotation += v.spin * dt;
      const k = v.t / v.life;
      p.alpha = v.fio ? Math.sin(Math.PI * k) : (k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }

  /* ------------------------------------------------------------ animation */
  function animate(it, t) {
    let a = it.anim, sc = 1, dx = 0, dy = 0, rot = 0, al = 1;
    const run = (an, tt) => {
      if (!an) return;
      const per = (an.periodMs || 1000) / 1000, w = Math.sin(2 * Math.PI * tt / per);
      switch (an.type) {
        case 'fadeIn': al *= clamp01(tt * 1000 / an.durationMs); break;
        case 'rotate': rot += tt * an.speedDegPerSec * Math.PI / 180; break;
        case 'pulse': sc *= an.scale[0] + (an.scale[1] - an.scale[0]) * (w + 1) / 2; break;
        case 'bob': dy += w * an.amplitudePx * (it.s || 1); break;
        case 'rock': case 'wobble': rot += w * an.deg * Math.PI / 180; break;
        case 'popIn': {
          const k = clamp01((tt * 1000 - (an.delayMs || 0)) / an.durationMs), e = (EASE[an.ease] || EASE.backOut)(k);
          if (tt * 1000 < (an.delayMs || 0)) al = 0;
          sc *= an.fromScale + (1 - an.fromScale) * e;
          if (k >= 1 && an.then) run(an.then, tt - ((an.delayMs || 0) + an.durationMs) / 1000);
          break;
        }
        case 'dropIn': {
          const k = clamp01((tt * 1000 - (an.delayMs || 0)) / an.durationMs), e = (EASE[an.ease] || EASE.backOut)(k);
          dy += an.fromY * (it.s || 1) * (1 - e); break;
        }
      }
    };
    run(a, t);
    const sp = it.sp;
    sp.x = it.bx + dx; sp.y = it.by + dy; sp.rotation = rot;
    if (!it.backdrop || a) sp.scale.set(it.bsx * sc * it.press, it.bsy * sc * it.press);
    sp.alpha = it.a * al;
  }

  /* ------------------------------------------------------------ show / close */
  function finish(scr, result) {
    if (scr.done) return; scr.done = true; scr.resolve(result);
  }
  function mount(scr) {
    const V = SC.deps.view();
    V.screenLayer.addChild(scr.c);
    for (const it of scr.items) animate(it, 0);
    const tick = (tk) => {
      if (scr.c.destroyed) { SC.deps.app.ticker.remove(tick); return; }
      const dt = Math.min(0.05, tk.deltaMS / 1000); scr.t += dt;
      if (scr.onTick) scr.onTick(dt);
      for (const it of scr.items) animate(it, scr.t);
      // the button label follows its plate's press scale
      for (const b of Object.values(scr.buttons)) if (b.label) { b.label.press = b.plate.press; }
      stepEmitters(scr, dt, V);
    };
    scr.tick = tick; SC.deps.app.ticker.add(tick);
  }
  async function unmount(scr, fadeMs = 280) {
    const c = scr.c; c.eventMode = 'none';
    await SC.deps.tween(c, { alpha: 0 }, fadeMs);
    SC.deps.app.ticker.remove(scr.tick); c.destroy({ children: true });
  }

  /* opts: { fields: {name: text}, count: {name: {to, ms?}}, hideViking, autoMs } -> resolves with the button name / 'auto' / 'tap' */
  SC.show = async function (id, opts = {}) {
    if (id !== 'intro') await SC.ready;
    const sc = SC.man.screens[id]; if (!sc) return 'missing';
    const V = SC.deps.view();
    const scr = build(id, V, opts);
    const done = new Promise((res) => { scr.resolve = res; });
    for (const [k, v] of Object.entries(opts.fields || {})) setField(scr, k, v);
    for (const [k, v] of Object.entries(opts.count || {})) {
      const f = scr.fields[k]; if (!f) continue;
      const ms = v.ms || (f.f.countUp && f.f.countUp.durationMs) || 2000, ease = EASE[(f.f.countUp && f.f.countUp.ease) || 'outCubic'] || EASE.outCubic;
      scr.counting = true; setField(scr, k, money(0));
      const prev = scr.onTick;
      scr.onTick = (dt) => {
        prev && prev(dt);
        if (!scr.counting) return;
        const kk = clamp01(scr.t * 1000 / ms); setField(scr, k, money(v.to * ease(kk)));
        if (kk >= 1) { scr.counting = false; scr.countEndT = scr.t; }
      };
      scr.skipCount = () => { scr.counting = false; scr.countEndT = scr.t; setField(scr, k, money(v.to)); };
    }
    if (opts.hideViking) SC.deps.vikingVisible(false);
    SC.open = scr;
    mount(scr);
    SC.deps.blip && SC.deps.blip(sc.modal ? 760 : 980);
    // dismissal
    const autoMs = opts.autoMs ?? ({ fsTrigger: 8000, fsOutro: 10000, retrigger: 1500 })[id];
    let timer = autoMs ? setTimeout(() => finish(scr, 'auto'), autoMs) : null;
    const backdrop = scr.items.find((it) => it.backdrop);
    if (id === 'intro' || id === 'buyConfirm') {
      const hit = backdrop ? backdrop.sp : scr.c;
      hit.eventMode = 'static'; hit.cursor = 'pointer';
      hit.on('pointertap', () => finish(scr, id === 'intro' ? 'tap' : 'Cancel'));
    } else if (sc.modal && backdrop) {
      backdrop.sp.eventMode = 'static';
      backdrop.sp.on('pointertap', () => { if (scr.counting && scr.skipCount) scr.skipCount(); });
    }
    scr.key = () => {
      if (scr.counting && scr.skipCount) return scr.skipCount();
      if (id === 'intro') return finish(scr, 'tap');
      if (id === 'buyConfirm') return finish(scr, 'Cancel');
      const b = Object.keys(scr.buttons)[0]; finish(scr, b || 'tap');
    };
    const result = await done;
    clearTimeout(timer);
    if (SC.open === scr) SC.open = null;
    await unmount(scr, id === 'intro' ? 300 : 250);
    if (opts.hideViking) SC.deps.vikingVisible(true);
    return result;
  };
  SC.key = function () { if (SC.open && SC.open.key) SC.open.key(); };

  /* BIG -> MEGA -> EPIC: one count-up, the screen swaps as the total passes 40x and 100x */
  SC.bigWin = async function (win, bet) {
    await SC.ready;
    const x = win / bet, ids = ['bigWin_big', 'bigWin_mega', 'bigWin_epic'];
    const th = ids.map((id) => SC.man.screens[id].tierThresholdX || 0);   // 15, 40, 100
    const finalTier = x >= th[2] ? 2 : x >= th[1] ? 1 : 0;
    const field = (id) => SC.man.screens[id].fields.find((f) => f.kind === 'money');
    const ms = (field(ids[finalTier]).countUp || {}).durationMs || 3000;
    const V = SC.deps.view();
    let tier = 0, scr = build(ids[0], V), value = 0, t = 0, counting = true, endT = null, closed = false;
    let resolve; const done = new Promise((r) => { resolve = r; });
    const holder = { key: null };
    const mountTier = (s) => {
      s.resolve = () => {};
      mount(s);
      s.counting = true;
      const bd = s.items.find((it) => it.backdrop);
      if (bd) { bd.sp.eventMode = 'static'; bd.sp.cursor = 'pointer'; bd.sp.on('pointertap', () => holder.key()); }
    };
    mountTier(scr); SC.open = holder;
    const fname = field(ids[0]).name;
    const tick = (tk) => {
      if (closed) return;
      const dt = Math.min(0.05, tk.deltaMS / 1000); t += dt;
      if (counting) {
        const k = clamp01(t * 1000 / ms); value = win * EASE.outCubic(k);
        if (k >= 1) { counting = false; endT = t; }
      }
      while (tier < finalTier && value >= th[tier + 1] * bet) {                // swap screens
        const old = scr; tier++;
        scr = build(ids[tier], V, { instantBackdrop: true }); mountTier(scr);
        if (tier === 2) SC.deps.vikingVisible(false);
        SC.deps.onTier && SC.deps.onTier(ids[tier]);
        unmount(old, 220);
      }
      scr.counting = counting; if (!counting && scr.countEndT == null) scr.countEndT = scr.t;
      setField(scr, fname, money(value));
      if (!counting && t - endT > 2.5) close();
    };
    const close = () => { if (closed) return; closed = true; SC.deps.app.ticker.remove(tick); resolve(); };
    holder.key = () => { if (counting) { t = ms / 1000; } else close(); };
    SC.deps.app.ticker.add(tick);
    await done;
    if (SC.open === holder) SC.open = null;
    await unmount(scr, 300);
    SC.deps.vikingVisible(true);
  };

  window.LDTScreens = SC;
})();
