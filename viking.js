/* Longship in the Drive-Thru: Animoto's Viking Spine rig (character/manifest.json), driven by game events.
   Follows the manifest's state machine:
   IDLE: idle_breathe loop, after each loop pick idle_breathe 60 / idle_bored 20 / idle_look_reels 20
   spin_start -> idle_look_reels (loop) until reels_stop; anticipation (loop) until reels_stop
   win_small / win_big / lose_grumble play through, then back to the base (idle, or free_spins_cheer during free spins)
   scatter_trigger -> free_spins_cheer (loop) for the whole feature; spin_start in free spins returns to the cheer
   Event clips always play through (the idle picker never cuts them); a new game event may interrupt with the mix. */
(function () {
  'use strict';
  const VK = { data: null, man: null, status: 'static (no rig)' };
  const IDLE_W = [['idle_breathe', 60], ['idle_bored', 20], ['idle_look_reels', 20]];

  VK.load = async function (base, man) {
    if (!man) return null;
    const files = man.files || man;
    const json = files.json || files.skeleton, atlas = files.atlas;
    if (!json || !atlas) { VK.status = 'static (manifest has no json/atlas)'; return null; }
    try {
      PIXI.Assets.add({ alias: 'vk_sk', src: base + json });
      PIXI.Assets.add({ alias: 'vk_at', src: base + atlas });
      await PIXI.Assets.load(['vk_sk', 'vk_at']);
      const test = spine.Spine.from({ skeleton: 'vk_sk', atlas: 'vk_at' });
      const anims = test.skeleton.data.animations.map((a) => a.name);
      test.destroy();
      VK.man = man;
      VK.data = { anims, has: (a) => anims.includes(a) };
      VK.status = 'spine: ' + anims.join(', ');
      return VK.data;
    } catch (e) {
      VK.status = 'static (rig failed: ' + (e && e.message || e) + ')';
      console.warn('viking rig', e);
      return null;
    }
  };

  /* Placement: the manifest gives origin/scale for the layout box Animoto measured. The PSD box may have moved since
     (Kris edits the PSDs), so the origin is the bottom-centre of the CURRENT box and the scale follows its width. */
  function placement(V) {
    const l = V.vikingLayer, key = V.orient === 'portrait' ? 'Portrait' : 'Landscape';
    const p = VK.man.placement && VK.man.placement[key];
    if (p && p.layout_box) {
      const ob = p.layout_box, k = l.w / ob[2];
      return { x: l.x + l.w / 2, y: l.y + l.h, s: (p.scale || 1) * k };
    }
    return { x: l.x + l.w / 2, y: l.y + l.h, s: 1 };
  }

  VK.attach = function (V) {
    const D = VK.data; if (!D || !V.viking || !V.vikingLayer) return null;
    const sprite = V.viking, root = V.root, pl = placement(V);
    const sp = spine.Spine.from({ skeleton: 'vk_sk', atlas: 'vk_at' });
    const mix = (VK.man && VK.man.mix) || {};
    sp.state.data.defaultMix = mix.default ?? 0.25;
    const setMix = (from, to, t) => { try { if (from !== to && D.has(from) && D.has(to)) sp.state.data.setMix(from, to, t); } catch (e) { /* optional */ } };
    for (const a of D.anims) {
      if (mix.to_idle != null) setMix(a, 'idle_breathe', mix.to_idle);
      if (mix.from_spin_start != null) setMix('spin_start', a, mix.from_spin_start);
      if (mix.anticipation_in != null) setMix(a, 'anticipation', mix.anticipation_in);
      if (mix.free_spins_cheer_in != null) setMix(a, 'free_spins_cheer', mix.free_spins_cheer_in);
    }
    sp.scale.set(pl.s);
    const holder = new PIXI.Container(); holder.position.set(pl.x, pl.y); holder.addChild(sp);
    root.addChildAt(holder, root.getChildIndex(sprite));
    sprite.visible = false; sprite.destroy();
    V.viking = holder;
    if (V.fxs) V.fxs.viking = null;                    // code tweens off: the rig animates itself

    const st = { fs: false, mode: 'idle', stopped: false };            // mode: idle | event | spinning
    const play = (a, loop) => { if (D.has(a)) { sp.state.setAnimation(0, a, loop); return true; } return false; };
    const pickIdle = () => {
      let r = Math.random() * 100;
      for (const [a, w] of IDLE_W) { if ((r -= w) < 0 && D.has(a)) return a; }
      return 'idle_breathe';
    };
    const toBase = () => {
      if (st.fs && D.has('free_spins_cheer')) { st.mode = 'event'; play('free_spins_cheer', true); }
      else { st.mode = 'idle'; play('idle_breathe', true); }
    };
    sp.state.addListener({
      complete: (entry) => {
        if (entry.trackIndex !== 0) return;
        const a = entry.animation && entry.animation.name;
        if (st.mode === 'idle' && /^idle_/.test(a)) {          // rotate idle variants after each loop
          const next = pickIdle();
          if (next !== a) play(next, true);
        } else if (st.mode === 'event' && !entry.loop) toBase();  // one-shot clip finished: back to the base
        else if (st.mode === 'spinning' && a === 'spin_start' && st.stopped) toBase();   // reels already stopped
      },
    });
    toBase();

    return {
      sp,
      play(ev) {
        switch (ev) {
          case 'spin_start':
            st.mode = 'spinning'; st.stopped = false;
            play('spin_start', false);
            sp.state.addAnimation(0, st.fs && D.has('free_spins_cheer') ? 'free_spins_cheer' : 'idle_look_reels', true, 0);
            return true;
          case 'anticipation': st.mode = 'spinning'; return play('anticipation', true);
          case 'reels_stop': {
            if (st.mode !== 'spinning') return true;
            st.stopped = true;
            if (this.current === 'spin_start') return true;   // let the press clip finish; the queued loop follows
            toBase(); return true;
          }
          case 'win_small': case 'win_big': case 'lose_grumble':
            if (st.fs && ev !== 'win_big') return true;       // keep the free-spins cheer going
            st.mode = 'event'; return play(ev, false);
          case 'scatter_trigger':
            st.fs = true; st.mode = 'event';
            play('scatter_trigger', false);
            if (D.has('free_spins_cheer')) sp.state.addAnimation(0, 'free_spins_cheer', true, 0);
            return true;
          case 'free_spins_cheer': st.fs = true; st.mode = 'event'; return play('free_spins_cheer', true);
          case 'free_spins_end': case 'idle': st.fs = false; toBase(); return true;
          default: return false;
        }
      },
      get current() { const t = sp.state.tracks[0]; return t && t.animation && t.animation.name; },
      get state() { return Object.assign({}, st); },
    };
  };
  window.LDTViking = VK;
})();
