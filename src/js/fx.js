// 파티클 / 화면 흔들림 / 슬로모션 (풀링으로 GC 최소화)
export class FX {
  constructor() {
    this.max = 700;
    const n = this.max;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.life = new Float32Array(n); this.ml = new Float32Array(n);
    this.sz = new Float32Array(n); this.kind = new Uint8Array(n); this.drag = new Float32Array(n); this.gr = new Float32Array(n);
    this.col = new Array(n).fill('#fff');
    this.count = 0;
    this.rings = [];
    this.texts = [];
    this.trauma = 0; this.shakeX = 0; this.shakeY = 0;
    this.slow = 0; this.slowScale = 1;
    this.flash = 0; this.flashCol = '#fff';
    this.level = 2; // 0 끔, 1 낮음, 2 보통, 3 높음
    this.shakeOn = true;
  }
  setLevel(l) { this.level = l; this.cap = [0, 180, 450, 700][l]; }
  spawn(x, y, vx, vy, life, size, col, kind = 0, drag = 2, gr = 0) {
    if (this.level === 0) return;
    if (this.count >= (this.cap || 450)) return;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.ml[i] = life; this.sz[i] = size; this.col[i] = col; this.kind[i] = kind; this.drag[i] = drag; this.gr[i] = gr;
  }
  burst(x, y, n, col, spd = 300, life = 0.5, kind = 1) {
    const k = this.level === 1 ? 0.4 : this.level === 3 ? 1.4 : 1;
    n = Math.ceil(n * k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), 1.5 + Math.random() * 2, col, kind, 3, 300);
    }
  }
  dir(x, y, n, ang, spread, col, spd = 300, life = 0.4) {
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * spread, s = spd * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), 1.5 + Math.random() * 1.5, col, 1, 4, 400);
    }
  }
  ring(x, y, r, col, life = 0.35, w = 3) {
    if (this.level === 0) return;
    if (this.rings.length > 40) this.rings.shift();
    this.rings.push({ x, y, r, col, life, ml: life, w });
  }
  shake(t) { if (this.shakeOn) this.trauma = Math.min(1, this.trauma + t); }
  slowmo(dur, scale = 0.2) { this.slow = Math.max(this.slow, dur); this.slowScale = scale; }
  doFlash(a, col = '#fff') { this.flash = Math.max(this.flash, a); this.flashCol = col; }
  popText(x, y, s, col) { if (this.texts.length > 20) this.texts.shift(); this.texts.push({ x, y, s, col, life: 0.9 }); }

  timeScale(rdt) {
    if (this.slow > 0) { this.slow -= rdt; return this.slowScale; }
    return 1;
  }
  update(dt, rdt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.x[i] = this.x[n]; this.y[i] = this.y[n]; this.vx[i] = this.vx[n]; this.vy[i] = this.vy[n];
        this.life[i] = this.life[n]; this.ml[i] = this.ml[n]; this.sz[i] = this.sz[n]; this.col[i] = this.col[n]; this.kind[i] = this.kind[n]; this.drag[i] = this.drag[n]; this.gr[i] = this.gr[n];
        i--; continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d + this.gr[i] * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
    }
    this.count = n;
    for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.life -= dt; if (r.life <= 0) this.rings.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.life -= rdt; t.y -= 40 * rdt; if (t.life <= 0) this.texts.splice(i, 1); }
    this.trauma = Math.max(0, this.trauma - rdt * 1.6);
    const s = this.trauma * this.trauma * 22;
    this.shakeX = (Math.random() * 2 - 1) * s; this.shakeY = (Math.random() * 2 - 1) * s;
    if (this.flash > 0) this.flash -= rdt * 3;
  }
  draw(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.count; i++) {
      const a = this.life[i] / this.ml[i];
      ctx.globalAlpha = a;
      ctx.fillStyle = this.col[i];
      if (this.kind[i] === 1) {
        ctx.strokeStyle = this.col[i]; ctx.lineWidth = this.sz[i];
        ctx.beginPath(); ctx.moveTo(this.x[i], this.y[i]); ctx.lineTo(this.x[i] - this.vx[i] * 0.03, this.y[i] - this.vy[i] * 0.03); ctx.stroke();
      } else {
        const s = this.sz[i] * (0.5 + a * 0.5);
        ctx.fillRect(this.x[i] - s, this.y[i] - s, s * 2, s * 2);
      }
    }
    for (const r of this.rings) {
      const k = 1 - r.life / r.ml;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.col; ctx.lineWidth = r.w * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.texts.length) {
      ctx.font = '700 14px Orbitron, sans-serif'; ctx.textAlign = 'center';
      for (const t of this.texts) { ctx.globalAlpha = Math.min(1, t.life * 2); ctx.fillStyle = t.col; ctx.fillText(t.s, t.x, t.y); }
      ctx.globalAlpha = 1;
    }
  }
}
