// 입력: 키보드/마우스, 터치(가상 조이스틱+버튼, 자동 조준), 게임패드
export class Input {
  constructor(canvas) {
    this.cv = canvas;
    this.keys = new Set();
    this.mode = 'kb';
    this.mouse = { x: 0, y: 0, l: false, r: false, moved: 0 };
    this.edge = { jump: false, hook: false, dash: false };
    this.prev = { jump: false, hook: false, dash: false };
    this.touch = { mx: 0, my: 0, jump: false, hook: false, dash: false };
    this.enabled = true;
    this.autoKey = false;
    this.bind();
  }
  bind() {
    const kd = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (this.mode === 'touch' || this.mode === 'pad') this.setMode('kb');
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    const cv = this.cv;
    cv.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = performance.now(); if (this.mode !== 'kb') this.setMode('kb'); });
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = performance.now();
      this.autoKey = false;
      if (this.mode !== 'kb') this.setMode('kb');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    this.bindTouch();
  }
  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    document.body.classList.toggle('touch', m === 'touch');
    if (this.onMode) this.onMode(m);
  }
  bindTouch() {
    const joy = document.getElementById('joy'), knob = document.getElementById('knob'), base = document.getElementById('joyBase');
    let jid = null, ox = 0, oy = 0;
    const R = 56;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px,${dy}px)`; };
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.setMode('touch');
      jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (err) { /* noop */ }
      ox = e.clientX; oy = e.clientY;
      base.style.left = ox + 'px'; base.style.top = oy + 'px'; base.classList.add('on');
      setKnob(0, 0);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId !== jid) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob(dx, dy);
      const nx = dx / R, ny = dy / R;
      this.touch.mx = Math.abs(nx) > 0.28 ? Math.sign(nx) * Math.min(1, Math.abs(nx) * 1.4) : 0;
      this.touch.my = Math.abs(ny) > 0.35 ? Math.sign(ny) * Math.min(1, Math.abs(ny) * 1.3) : 0;
    });
    const jEnd = (e) => {
      if (e.pointerId !== jid) return;
      jid = null; this.touch.mx = 0; this.touch.my = 0; setKnob(0, 0); base.classList.remove('on');
    };
    joy.addEventListener('pointerup', jEnd); joy.addEventListener('pointercancel', jEnd);
    const btn = (id, key) => {
      const el = document.getElementById(id);
      const ids = new Set();
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setMode('touch'); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } this.touch[key] = true; el.classList.add('on'); });
      const up = (e) => { ids.delete(e.pointerId); if (!ids.size) { this.touch[key] = false; el.classList.remove('on'); } };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    btn('bJump', 'jump'); btn('bHook', 'hook'); btn('bDash', 'dash');
  }
  reset() {
    this.keys.clear(); this.mouse.l = this.mouse.r = false;
    Object.assign(this.touch, { mx: 0, my: 0, jump: false, hook: false, dash: false });
  }
  // 프레임마다 한 번 호출
  poll() {
    const k = this.keys;
    let mx = 0, my = 0;
    let jump = false, hook = false, dash = false, auto = false;
    if (this.enabled) {
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
      jump = k.has('Space') || k.has('KeyC');
      const keyHook = k.has('KeyJ') || k.has('KeyX');
      if (keyHook) this.autoKey = true;
      hook = this.mouse.l || keyHook;
      auto = keyHook && !this.mouse.l;
      dash = k.has('ShiftLeft') || k.has('ShiftRight') || this.mouse.r || k.has('KeyK') || k.has('KeyZ');
      // 터치
      if (this.mode === 'touch') {
        mx = this.touch.mx || mx; my = this.touch.my || my;
        jump = jump || this.touch.jump; hook = hook || this.touch.hook; dash = dash || this.touch.dash;
        auto = true;
      }
      // 게임패드
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
        const any = Math.abs(ax) > 0.3 || Math.abs(ay) > 0.3 || gp.buttons.some((x) => x.pressed);
        if (any && this.mode !== 'pad') this.setMode('pad');
        if (this.mode !== 'pad') continue;
        if (Math.abs(ax) > 0.3) mx = Math.sign(ax) * Math.min(1, Math.abs(ax) * 1.3);
        if (Math.abs(ay) > 0.35) my = Math.sign(ay) * Math.min(1, Math.abs(ay) * 1.3);
        if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) my = -1; if (b(13)) my = 1;
        jump = jump || b(0); hook = hook || b(7) || b(5) || b(2); dash = dash || b(6) || b(4) || b(1);
        auto = true;
        const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
        this.padAim = Math.hypot(rx, ry) > 0.5 ? { x: rx, y: ry } : null;
        break;
      }
    }
    const st = {
      mx, my,
      jumpH: jump, hookH: hook, dashH: dash,
      jumpP: jump && !this.prev.jump, hookP: hook && !this.prev.hook, dashP: dash && !this.prev.dash,
      auto: auto || this.mode !== 'kb' || (this.autoKey && !this.mouse.l),
      sx: this.mouse.x, sy: this.mouse.y,
    };
    this.prev.jump = jump; this.prev.hook = hook; this.prev.dash = dash;
    return st;
  }
}
