/* Longship in the Drive-Thru: code effects (ambient world, frame/logo shine, mead meter liquid, win juice).
   All positions are layout px per orientation. Everything is pooled or long-lived to stay at 60 fps. */
(function () {
  'use strict';
  const R = (a, b) => a + Math.random() * (b - a);

  // features painted into Aiko's backgrounds (measured from the previews)
  const POS = {
    landscape: {
      sky: [380, 0, 1540, 300], neon: [1850, 260, 92], wsign: [1640, 112, 170], ship: [1380, 85, 420, 330],
      vents: [[1325, 222], [1480, 165], [1840, 150]], mist: [[0, 1920, 900, 1000]], ravenY: [40, 230],
    },
    portrait: {
      sky: [0, 380, 1080, 280], neon: [1047, 515, 60], wsign: [928, 428, 105], ship: [760, 410, 260, 190],
      vents: [[718, 492], [752, 487], [842, 440]], mist: [[0, 1080, 560, 640], [0, 1080, 1560, 1760]], ravenY: [400, 560],
    },
  };
  const DRIPS = [0.71, 0.76, 0.88, 0.94], DRIP_Y = 0.93;

  const FX = {};
  let app, T = {};

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return PIXI.Texture.from(c);
  }
  FX.init = function (_app) {
    app = _app;
    T.soft = canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    T.band = canvasTex(256, 32, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,250,220,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    T.star = canvasTex(64, 64, (g) => {
      g.translate(32, 32); g.fillStyle = '#fff';
      for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(0, -30); g.quadraticCurveTo(3, -3, 30, 0); g.quadraticCurveTo(3, 3, 0, 30); g.quadraticCurveTo(-3, 3, -30, 0); g.quadraticCurveTo(-3, -3, 0, -30); g.fill(); g.rotate(Math.PI / 4); g.scale(0.55, 0.55); }
    });
    T.coin = canvasTex(48, 48, (g) => {
      g.fillStyle = '#b8860b'; g.beginPath(); g.arc(24, 24, 22, 0, 7); g.fill();
      g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(24, 24, 17, 0, 7); g.fill();
      g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(18, 17, 5, 0, 7); g.fill();
    });
    T.nugget = canvasTex(48, 48, (g) => {
      g.fillStyle = '#9a5a12'; g.beginPath();
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = 17 + Math.sin(i * 2.7) * 4; g.lineTo(24 + Math.cos(a) * r, 24 + Math.sin(a) * r * 0.8); }
      g.fill(); g.fillStyle = '#e8a83a'; g.beginPath(); g.ellipse(22, 21, 13, 9, 0, 0, 7); g.fill();
    });
    T.drop = canvasTex(32, 48, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(16, 2); g.quadraticCurveTo(30, 30, 16, 44); g.quadraticCurveTo(2, 30, 16, 2); g.fill();
    });
    T.dot = canvasTex(16, 16, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(8, 8, 7, 0, 7); g.fill(); });
  };

  /* ---------------------------------------------------------- particles (pooled) */
  function makePool(layer) { return { layer, live: [], free: [] }; }
  function spawn(pool, tex, o) {
    const s = pool.free.pop() || new PIXI.Sprite();
    s.texture = tex; s.anchor.set(0.5); s.visible = true; s.alpha = o.alpha ?? 1; s.tint = o.tint ?? 0xffffff;
    s.blendMode = o.blend || 'normal'; s.position.set(o.x, o.y); s.rotation = o.rot || 0; s.scale.set(o.s || 1);
    s.p = { vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, life: o.life || 1, t: 0, s0: o.s || 1, s1: o.s1 ?? (o.s || 1), a0: s.alpha, vr: o.vr || 0, fadeIn: o.fadeIn || 0, drag: o.drag || 0 };
    if (!s.parent) pool.layer.addChild(s);
    pool.live.push(s);
    return s;
  }
  function stepPool(pool, dt) {
    const L = pool.live;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i], p = s.p; p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { s.visible = false; L[i] = L[L.length - 1]; L.pop(); pool.free.push(s); continue; }
      p.vy += p.g * dt; if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
      s.x += p.vx * dt; s.y += p.vy * dt; s.rotation += p.vr * dt;
      s.scale.set(p.s0 + (p.s1 - p.s0) * k);
      s.alpha = p.a0 * (p.fadeIn && k < p.fadeIn ? k / p.fadeIn : (k > 0.6 ? (1 - k) / 0.4 : 1));
    }
  }

  /* ---------------------------------------------------------- build per view */
  FX.build = function (V, L) {
    const P = POS[V.orient], root = V.root;
    const S = V.fxs = { t: 0, shake: 0, winGlow: 0, whoosh: 0, nextSweep: 2, nextShine: 3.5, nextGlint: 0.5, nextDrip: 1.5,
      nextRaven: R(3, 7), nextSteam: 0, flick: 0, wbuzz: 0, ravens: [], meterLevel: 0 };

    // ---- world layer right above the background
    const bgIdx = root.getChildIndex(V.bgSprite) + 1;
    const world = new PIXI.Container(); root.addChildAt(world, bgIdx); S.world = world;
    // longship cut from the background texture, rocking about its keel
    const bl = V.bgLayer, [sx, sy, sw, sh] = P.ship;
    const shipTex = new PIXI.Texture({ source: V.bgSprite.texture.source, frame: new PIXI.Rectangle(sx - bl.x, sy - bl.y, sw, sh) });
    S.ship = new PIXI.Sprite(shipTex); S.ship.anchor.set(0.5, 1); S.ship.position.set(sx + sw / 2, sy + sh);
    world.addChild(S.ship);
    // clouds (two parallax layers), masked to the sky band
    const [kx, ky, kw, kh] = P.sky;
    const clouds = new PIXI.Container(); world.addChild(clouds);
    const cmask = new PIXI.Graphics().rect(kx, ky, kw, kh).fill(0xffffff); world.addChild(cmask); clouds.mask = cmask;
    S.clouds = [];
    for (let i = 0; i < 9; i++) {
      const far = i < 5, c = new PIXI.Sprite(T.soft); c.anchor.set(0.5);
      c.tint = far ? 0x3b4170 : 0x7a5a86; c.alpha = far ? 0.35 : 0.22;
      c.scale.set(R(2.2, 3.6) * (V.orient === 'portrait' ? 0.8 : 1), R(0.7, 1.1));
      c.position.set(R(kx, kx + kw), R(ky + kh * 0.15, ky + kh * 0.8));
      c.speed = far ? R(5, 9) : R(13, 20); clouds.addChild(c); S.clouds.push(c);
    }
    // neon + W sign glows
    const [nx, ny, nr] = P.neon;
    S.neon = new PIXI.Sprite(T.soft); S.neon.anchor.set(0.5); S.neon.position.set(nx, ny); S.neon.scale.set(nr / 50);
    S.neon.tint = 0xff4fd8; S.neon.blendMode = 'add'; world.addChild(S.neon);
    S.neonDark = new PIXI.Graphics().rect(nx - nr / 2, ny - nr / 2, nr, nr).fill({ color: 0x0b0a1e, alpha: 0.55 }); S.neonDark.alpha = 0; world.addChild(S.neonDark);
    const [wx, wy, wr] = P.wsign;
    S.wglow = new PIXI.Sprite(T.soft); S.wglow.anchor.set(0.5); S.wglow.position.set(wx, wy); S.wglow.scale.set(wr / 55);
    S.wglow.tint = 0xffb52e; S.wglow.blendMode = 'add'; world.addChild(S.wglow);
    // steam, mist, ravens
    S.steam = makePool(world.addChild(new PIXI.Container()));
    S.mist = [];
    for (const [x0, x1, y0, y1] of P.mist) for (let i = 0; i < 6; i++) {
      const m = new PIXI.Sprite(T.soft); m.anchor.set(0.5); m.tint = 0xd8485a; m.alpha = R(0.18, 0.3);
      m.scale.set(R(4, 6), R(0.9, 1.4)); m.position.set(R(x0, x1), R(y0, y1)); m.band = [x0, x1]; m.speed = R(8, 22) * (Math.random() < 0.5 ? -1 : 1);
      m.phase = R(0, 6); world.addChild(m); S.mist.push(m);
    }
    S.ravenLayer = world.addChild(new PIXI.Container());

    // ---- frame: light sweep, rivet glints, win edge glow
    if (V.frameSprite) {
      const f = V.frameSprite, fl = V.frameLayer, idx = root.getChildIndex(f) + 1;
      const fx = new PIXI.Container(); root.addChildAt(fx, idx);
      const fm = new PIXI.Sprite(f.texture); fm.anchor.set(0.5); fm.position.copyFrom(f.position); fm.scale.copyFrom(f.scale);
      fx.addChild(fm);
      S.sweep = new PIXI.Sprite(T.band); S.sweep.anchor.set(0.5); S.sweep.blendMode = 'add'; S.sweep.alpha = 0;
      S.sweep.rotation = -0.5; S.sweep.scale.set(2.2, fl.h / 18); S.sweep.mask = fm; fx.addChild(S.sweep);
      S.frameBox = fl;
      S.edge = new PIXI.Graphics(); S.edge.blendMode = 'add'; fx.addChild(S.edge);
      S.glints = makePool(fx);
    }
    // ---- logo: shine sweep + drips
    if (V.logo) {
      const lg = V.logo, ll = V.logoLayer, idx = root.getChildIndex(lg) + 1;
      const lx = new PIXI.Container(); root.addChildAt(lx, idx); S.logoFx = lx;
      const lm = new PIXI.Sprite(lg.texture); lm.anchor.set(0.5); lx.addChild(lm); S.logoMask = lm;
      S.shine = new PIXI.Sprite(T.band); S.shine.anchor.set(0.5); S.shine.blendMode = 'add'; S.shine.alpha = 0;
      S.shine.rotation = -0.35; S.shine.scale.set(1.6, ll.h / 14); S.shine.mask = lm; lx.addChild(S.shine);
      S.drips = makePool(root.addChildAt(new PIXI.Container(), idx));
      S.logoBaseY = lg.y;
    }
    // ---- mead meter liquid
    if (V.meter) {
      const idx = root.getChildIndex(V.meterSprite) + 1;
      const mc = new PIXI.Container(); root.addChildAt(mc, idx);
      S.mglow = new PIXI.Sprite(T.soft); S.mglow.anchor.set(0.5); S.mglow.tint = 0xffa21a; S.mglow.blendMode = 'add';
      S.mglow.position.set(V.meter.x + V.meter.w / 2, V.meter.y + V.meter.h * 0.6); S.mglow.scale.set(V.meter.w / 30, V.meter.h / 60);
      mc.addChild(S.mglow);
      S.liquid = new PIXI.Graphics(); mc.addChild(S.liquid);
      S.bubbles = makePool(mc.addChild(new PIXI.Container()));
      S.foam = makePool(mc.addChild(new PIXI.Container()));
    }
    // ---- spin button glow (behind the button)
    if (V.spinBtn) {
      S.spinGlow = new PIXI.Sprite(T.soft); S.spinGlow.anchor.set(0.5); S.spinGlow.tint = 0xffb020; S.spinGlow.blendMode = 'add';
      S.spinGlow.position.copyFrom(V.spinBtn.position); S.spinGlow.scale.set(V.spinBtn.width / 70); S.spinGlow.alpha = 0.25;
      root.addChildAt(S.spinGlow, root.getChildIndex(V.spinBtn));
    }
    // ---- top particle layer + anticipation column glow
    S.parts = makePool(V.fx);
    S.antic = new PIXI.Graphics(); S.antic.blendMode = 'add'; root.addChildAt(S.antic, root.getChildIndex(V.reels));
    S.viking = V.viking ? { x: V.viking.x, y: V.viking.y, sx: V.viking.scale.x, sy: V.viking.scale.y, yell: 0, squash: 0 } : null;
  };

  /* ---------------------------------------------------------- per frame */
  FX.update = function (V, dt, meterFrac, busy) {
    const S = V.fxs; if (!S) return;
    S.t += dt; const t = S.t, P = POS[V.orient];

    // longship rocking
    S.ship.rotation = Math.sin(t * 0.9) * 0.006; S.ship.y = P.ship[1] + P.ship[3] + Math.sin(t * 0.9 + 1) * 1.2;
    // clouds drift (wrap in the sky band)
    const [kx, , kw] = P.sky;
    for (const c of S.clouds) { c.x += c.speed * dt; if (c.x - c.width / 2 > kx + kw) c.x = kx - c.width / 2; }
    // neon flicker: mostly on, random short dropouts
    S.flick -= dt;
    if (S.flick <= 0) { S.flick = Math.random() < 0.15 ? R(0.04, 0.12) : R(0.6, 3); S.neonOff = S.flick < 0.13; }
    S.neon.alpha = S.neonOff ? 0.05 : 0.55 + Math.sin(t * 40) * 0.05; S.neonDark.alpha = S.neonOff ? 1 : 0;
    // W sign buzz
    S.wbuzz -= dt; if (S.wbuzz <= 0) S.wbuzz = R(0.03, 0.5);
    S.wglow.alpha = 0.32 + Math.sin(t * 50) * 0.04 + (S.wbuzz < 0.06 ? -0.2 : 0) + Math.sin(t * 2) * 0.05;
    // steam
    S.nextSteam -= dt;
    if (S.nextSteam <= 0) {
      S.nextSteam = 0.18;
      const [vx, vy] = P.vents[(Math.random() * P.vents.length) | 0];
      spawn(S.steam, T.soft, { x: vx + R(-6, 6), y: vy, vx: R(-4, 6), vy: R(-26, -16), life: R(2.5, 3.8), s: 0.25, s1: R(0.9, 1.4), alpha: 0.22, tint: 0xd9d2e6, fadeIn: 0.25 });
    }
    stepPool(S.steam, dt);
    // red mist roll
    for (const m of S.mist) {
      m.x += m.speed * dt; const [x0, x1] = m.band;
      if (m.x > x1 + 300) m.x = x0 - 300; if (m.x < x0 - 300) m.x = x1 + 300;
      m.alpha = 0.2 + Math.sin(t * 0.5 + m.phase) * 0.07;
    }
    // ravens
    S.nextRaven -= dt;
    if (S.nextRaven <= 0) { S.nextRaven = R(9, 16); spawnRavens(V); }
    for (let i = S.ravens.length - 1; i >= 0; i--) {
      const b = S.ravens[i]; b.x += b.vx * dt; b.y += Math.sin(t * 1.3 + b.ph) * 0.15;
      const flap = Math.sin(t * 9 + b.ph), w = 14 * b.k, h = 7 * b.k * flap;
      b.clear().moveTo(-w, -h).quadraticCurveTo(-w * 0.4, -h * 0.2 - 2 * b.k, 0, 0).quadraticCurveTo(w * 0.4, -h * 0.2 - 2 * b.k, w, -h)
        .lineTo(w * 0.5, -h * 0.4 + 1.5 * b.k).lineTo(0, 2.5 * b.k).lineTo(-w * 0.5, -h * 0.4 + 1.5 * b.k).closePath().fill({ color: 0x14101c, alpha: 0.85 });
      if ((b.vx > 0 && b.x > b.end) || (b.vx < 0 && b.x < b.end)) { b.destroy(); S.ravens.splice(i, 1); }
    }

    // frame sweep + glints + win edge glow
    if (S.sweep) {
      const fb = S.frameBox;
      S.nextSweep -= dt;
      if (S.nextSweep <= 0) { S.nextSweep = R(4.5, 6.5); S.sweepT = 0; }
      if (S.sweepT != null) {
        S.sweepT += dt / 1.3; const k = S.sweepT;
        S.sweep.x = fb.x - 200 + (fb.w + 400) * k; S.sweep.y = fb.y + fb.h / 2; S.sweep.alpha = Math.sin(Math.PI * Math.min(1, k)) * 0.7;
        if (k >= 1) { S.sweepT = null; S.sweep.alpha = 0; }
      }
      S.nextGlint -= dt;
      if (S.nextGlint <= 0) {
        S.nextGlint = R(0.25, 0.8);
        const side = (Math.random() * 4) | 0, u = Math.random(), m = 16;
        const x = side < 2 ? fb.x + m + u * (fb.w - 2 * m) : (side === 2 ? fb.x + m : fb.x + fb.w - m);
        const y = side >= 2 ? fb.y + m + u * (fb.h - 2 * m) : (side === 0 ? fb.y + m : fb.y + fb.h - m);
        spawn(S.glints, T.star, { x, y, life: 0.5, s: 0.05, s1: 0.45, alpha: 0.9, blend: 'add', vr: 2, tint: 0xfff4c8, fadeIn: 0.4 });
      }
      stepPool(S.glints, dt);
      S.winGlow += ((V.winOn ? 1 : 0) - S.winGlow) * Math.min(1, dt * 8);
      S.edge.clear();
      if (S.winGlow > 0.01) {
        const a = S.winGlow * (0.6 + Math.sin(t * 10) * 0.25);
        S.edge.roundRect(fb.x + 6, fb.y + 6, fb.w - 12, fb.h - 12, 26).stroke({ color: 0xffb020, width: 22, alpha: a * 0.35 })
          .roundRect(fb.x + 10, fb.y + 10, fb.w - 20, fb.h - 20, 22).stroke({ color: 0xffe08a, width: 7, alpha: a });
      }
    }

    // logo bob/breathe + shine + drips
    if (V.logo) {
      const lg = V.logo, ll = V.logoLayer;
      lg.y = S.logoBaseY + Math.sin(t * 1.4) * 4; lg.scale.set(lg.baseScale * (1 + Math.sin(t * 1.6) * 0.008));
      S.logoMask.position.copyFrom(lg.position); S.logoMask.scale.copyFrom(lg.scale);
      S.nextShine -= dt;
      if (S.nextShine <= 0) { S.nextShine = R(5, 8); S.shineT = 0; }
      if (S.shineT != null) {
        S.shineT += dt / 1.1; const k = S.shineT;
        S.shine.x = ll.x - 150 + (ll.w + 300) * k; S.shine.y = lg.y; S.shine.alpha = Math.sin(Math.PI * Math.min(1, k)) * 0.85;
        if (k >= 1) { S.shineT = null; S.shine.alpha = 0; }
      }
      S.nextDrip -= dt;
      if (S.nextDrip <= 0) {
        S.nextDrip = R(1.8, 4);
        const fx = DRIPS[(Math.random() * DRIPS.length) | 0], dy = lg.y - S.logoBaseY;
        spawn(S.drips, T.drop, { x: ll.x + ll.w * fx, y: ll.y + ll.h * DRIP_Y + dy - 4, vy: 10, g: 260, life: 0.9, s: 0.28 * (ll.w / 740), s1: 0.36 * (ll.w / 740), tint: 0xc8141c, fadeIn: 0.15 });
      }
      stepPool(S.drips, dt);
    }

    // mead meter liquid
    if (S.liquid) {
      const m = V.meter, f = Math.max(0, Math.min(1, meterFrac));
      const top = m.y + m.h * (1 - f), wob = (1.5 + S.whoosh * 5) * (f > 0.005 ? 1 : 0);
      const g = S.liquid.clear();
      if (f > 0.003) {
        g.moveTo(m.x, m.y + m.h);
        for (let i = 0; i <= 8; i++) { const x = m.x + m.w * i / 8; g.lineTo(x, Math.max(m.y, top + Math.sin(t * 6 + i * 0.9) * wob)); }
        g.lineTo(m.x + m.w, m.y + m.h).closePath().fill({ color: 0xff9a14, alpha: 0.85 });
        g.rect(m.x + m.w * 0.18, top + 3, m.w * 0.16, Math.max(0, m.y + m.h - top - 6)).fill({ color: 0xffe9a8, alpha: 0.35 });
      }
      if (f > 0.02 && Math.random() < dt * (3 + f * 10)) {
        spawn(S.bubbles, T.dot, { x: m.x + R(m.w * 0.2, m.w * 0.8), y: m.y + m.h - 3, vy: R(-40, -22), life: Math.max(0.2, (m.h * f) / 32), s: R(0.15, 0.32), alpha: 0.75, tint: 0xfff2c0 });
      }
      for (const b of S.bubbles.live) if (b.y < top + 2) b.p.t = b.p.life;   // pop at the surface
      stepPool(S.bubbles, dt);
      if (f >= 0.98 && Math.random() < dt * 14) {
        spawn(S.foam, T.soft, { x: m.x + R(0, m.w), y: m.y - 2, vx: R(-14, 14), vy: R(-30, -8), g: 70, life: R(0.6, 1.1), s: R(0.12, 0.22), s1: 0.05, alpha: 0.95, tint: 0xfff6dc });
      }
      stepPool(S.foam, dt);
      S.whoosh = Math.max(0, S.whoosh - dt * 1.5);
      S.mglow.alpha = 0.15 + f * 0.35 + Math.sin(t * 3) * 0.08 * (0.3 + f) + S.whoosh * 0.6;
    }

    // spin button glow, viking idle/yell/squash
    if (S.spinGlow) S.spinGlow.alpha = busy ? 0.4 : 0.18 + Math.sin(t * 2) * 0.08;   // no rotation anywhere on the spin button
    if (S.viking && V.viking) {
      const vk = S.viking, v = V.viking;
      vk.yell = Math.max(0, vk.yell - dt); vk.squash = Math.max(0, vk.squash - dt * 1.6);
      const sq = Math.sin(vk.squash * Math.PI * 3) * vk.squash * 0.12;
      v.rotation = Math.sin(t * 1.7) * 0.02 + (vk.yell > 0 ? Math.sin(t * 60) * 0.035 * Math.min(1, vk.yell * 2) : 0);
      v.scale.set(vk.sx * (1 + sq), vk.sy * (1 + Math.sin(t * 2.2) * 0.012 - sq));
      v.x = vk.x + Math.sin(t * 0.85) * 3; v.y = vk.y + Math.abs(Math.sin(t * 1.7)) * -3;
    }
    // particles + camera shake
    stepPool(S.parts, dt);
    S.shake = Math.max(0, S.shake - dt * 30);
    V.shakeX = S.shake ? R(-S.shake, S.shake) : 0; V.shakeY = S.shake ? R(-S.shake, S.shake) : 0;
    // anticipation column glow
    S.antic.clear();
    if (V.anticCols && V.anticCols.size) {
      for (const r of V.anticCols) {
        const a = 0.25 + Math.sin(t * 12) * 0.12;
        S.antic.roundRect(V.cx[r] - V.colW / 2 + 4, V.win.y + 4, V.colW - 8, V.win.h - 8, 18).fill({ color: 0x6ad7ff, alpha: a * 0.35 })
          .stroke({ color: 0x9be7ff, width: 6, alpha: a + 0.3 });
      }
    }
  };

  function spawnRavens(V) {
    const S = V.fxs, P = POS[V.orient], [kx, , kw] = P.sky;
    const dir = Math.random() < 0.5 ? 1 : -1, n = 2 + ((Math.random() * 3) | 0), y0 = R(P.ravenY[0], P.ravenY[1]);
    for (let i = 0; i < n; i++) {
      const b = new PIXI.Graphics(); b.k = R(0.8, 1.3);
      b.x = (dir > 0 ? kx - 40 : kx + kw + 40) - dir * i * R(25, 45); b.y = y0 + R(-18, 18);
      b.vx = dir * R(70, 95); b.end = dir > 0 ? kx + kw + 60 : kx - 60; b.ph = R(0, 6);
      S.ravenLayer.addChild(b); S.ravens.push(b);
    }
  }

  /* ---------------------------------------------------------- hooks from the game */
  FX.burst = function (V, x, y, n = 14) {
    const S = V.fxs; if (!S) return;
    const kinds = [[T.coin, 0xffffff], [T.nugget, 0xffffff], [T.drop, 0xffb52e]];
    for (let i = 0; i < n; i++) {
      const [tex, tint] = kinds[i % 3], a = R(0, Math.PI * 2), sp = R(160, 420);
      spawn(S.parts, tex, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 180, g: 900, life: R(0.7, 1.1), s: R(0.5, 0.9), s1: 0.3, vr: R(-8, 8), tint, rot: R(0, 6) });
    }
    spawn(S.parts, T.soft, { x, y, life: 0.35, s: 0.6, s1: 2.4, alpha: 0.8, blend: 'add', tint: 0xffd36a });
  };
  FX.shake = function (V, amp) { if (V.fxs) V.fxs.shake = Math.max(V.fxs.shake, amp); };
  FX.whoosh = function (V) {
    const S = V.fxs; if (!S || !V.meter) return;
    S.whoosh = 1;
    for (let i = 0; i < 6; i++) spawn(S.bubbles, T.dot, { x: V.meter.x + R(0, V.meter.w), y: V.meter.y + V.meter.h, vy: R(-120, -60), life: 0.6, s: R(0.2, 0.35), alpha: 0.9, tint: 0xfff2c0 });
  };
  FX.yell = function (V, s = 0.8) { if (V.fxs && V.fxs.viking) V.fxs.viking.yell = s; };
  FX.squash = function (V) { if (V.fxs && V.fxs.viking) { V.fxs.viking.squash = 1; V.fxs.viking.yell = 1.4; } };
  window.LDTFX = FX;
})();
