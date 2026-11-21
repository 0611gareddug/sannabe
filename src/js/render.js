// 캔버스 렌더러: 네온 벡터 스타일. 타일은 청크 단위로 미리 그려 캐시(LRU)한다.
import { TS, T, THEMES, P } from './config.js';
import { hash2, TAU, clamp } from './util.js';
import { HOOK } from './player.js';

const CH = 16, CPX = CH * TS;

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.glows = new Map();
    this.chunks = new Map();
    this.quality = 2; // 0 저, 1 중, 2 고
    this.cam = { x: 0, y: 0, s: 1 };
    this.time = 0;
    this.rain = [];
    this.resize();
  }
  resize() {
    const dprCap = this.quality >= 2 ? 2 : this.quality === 1 ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    this.cv.width = w; this.cv.height = h;
    this.cv.style.width = window.innerWidth + 'px'; this.cv.style.height = window.innerHeight + 'px';
    this.w = w; this.h = h; this.dpr = dpr;
    // 화면 높이 기준 시야: 모바일 가로는 조금 더 가깝게
    const viewH = (window.innerHeight < 520 ? 470 : 600) * (this.zoom || 1);
    this.cam.s = h / viewH;
    this.chunks.clear();
    this.skyGrad = null;
    this.uiScale = Math.max(0.75, Math.min(1.6, h / 900));
  }
  setQuality(q) { this.quality = q; this.resize(); this.buildBg(); }

  glow(col) {
    let g = this.glows.get(col);
    if (!g) {
      g = document.createElement('canvas'); g.width = g.height = 64;
      const c = g.getContext('2d');
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, col); gr.addColorStop(0.25, col + 'aa'); gr.addColorStop(1, col + '00');
      c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
      this.glows.set(col, g);
    }
    return g;
  }
  dg(x, y, r, col, a = 1) {
    const c = this.ctx;
    c.globalAlpha = a; c.drawImage(this.glow(col), x - r, y - r, r * 2, r * 2); c.globalAlpha = 1;
  }

  setLevel(lv, world) {
    this.lv = lv; this.world = world;
    this.theme = THEMES[lv.def.theme || 0];
    const z = lv.def.boss ? 1.5 : 1;
    if (z !== (this.zoom || 1)) { this.zoom = z; this.resize(); }
    this.chunks.clear();
    this.buildBg();
  }

  // ---------- 배경 ----------
  buildBg() {
    if (!this.theme) return;
    const th = this.theme;
    this.layers = [0.08, 0.2, 0.38].map((f, li) => {
      const W = 1400, H = 700;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const shade = ['#120b2a', '#0b0720', '#06040f'][li];
      let px = 0, seed = li * 1000 + 7;
      while (px < W) {
        const bw = 40 + hash2(seed++, li) * (li === 0 ? 90 : 130);
        const bh = 160 + hash2(seed++, li * 3) * (li === 0 ? 420 : li === 1 ? 380 : 300);
        x.fillStyle = shade;
        x.fillRect(px, H - bh, bw, bh);
        // 안테나/옥상
        if (hash2(seed, 9) < 0.3) x.fillRect(px + bw * 0.4, H - bh - 30, 3, 30);
        // 창문
        const wc = th.win;
        for (let wy = H - bh + 12; wy < H - 10; wy += 14) for (let wx = px + 6; wx < px + bw - 8; wx += 10) {
          const r = hash2(wx * 7 + li, wy * 3);
          if (r < (li === 2 ? 0.08 : 0.16)) {
            x.globalAlpha = 0.25 + r * 2.5 * (li === 2 ? 0.6 : 0.4);
            x.fillStyle = wc[Math.floor(r * 100) % 3];
            x.fillRect(wx, wy, 5, 6);
          }
        }
        x.globalAlpha = 1;
        // 네온 간판
        if (li > 0 && hash2(seed, 21) < 0.35) {
          const col = hash2(seed, 5) < 0.5 ? th.edge : th.edge2;
          const sy = H - bh + 30 + hash2(seed, 6) * 80;
          x.shadowColor = col; x.shadowBlur = 14; x.fillStyle = col; x.globalAlpha = li === 1 ? 0.55 : 0.8;
          if (hash2(seed, 8) < 0.5) x.fillRect(px + bw - 8, sy, 5, 60 + hash2(seed, 3) * 60);
          else x.fillRect(px + 8, sy, bw - 16, 4);
          x.shadowBlur = 0; x.globalAlpha = 1;
        }
        px += bw + (li === 0 ? 4 : 10) + hash2(seed++, 2) * 20;
      }
      // 가장자리 이음새 자연스럽게
      return { c, f, W, H };
    });
    this.rain = [];
    const n = Math.floor(160 * th.rain * (this.quality === 0 ? 0.4 : 1));
    for (let i = 0; i < n; i++) this.rain.push([Math.random(), Math.random(), 0.6 + Math.random() * 0.8]);
    this.skyGrad = null;
  }
  drawBg(dt) {
    const c = this.ctx, th = this.theme, w = this.w, h = this.h;
    if (!this.skyGrad) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, th.sky[0]); g.addColorStop(0.55, th.sky[1]); g.addColorStop(1, th.sky[2]);
      this.skyGrad = g;
    }
    c.fillStyle = this.skyGrad; c.fillRect(0, 0, w, h);
    const cam = this.cam;
    // 거대한 홀로그램 원반(달)
    const mx = w * 0.72 - (cam.x * 0.02 * cam.s) % (w * 2), my = h * 0.3 - cam.y * 0.01 * cam.s;
    const mr = h * 0.22;
    c.globalCompositeOperation = 'lighter';
    this.dg(mx, my, mr * 2.2, th.edge2, 0.16);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = th.edge2; c.globalAlpha = 0.12;
    c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = th.sky[1];
    for (let i = 0; i < 6; i++) c.fillRect(mx - mr, my + mr * (0.1 + i * 0.15), mr * 2, mr * (0.02 + i * 0.012));
    // 빌딩 레이어
    const sc = h / 720;
    for (const L of this.layers) {
      const lw = L.W * sc, lh = L.H * sc;
      let ox = -((cam.x * L.f * cam.s) % lw); if (ox > 0) ox -= lw;
      const baseY = h - lh + clamp((this.world.ph * 0.5 - cam.y) * L.f * cam.s * 0.35, -h * 0.25, h * 0.35) + h * 0.12;
      for (let x = ox; x < w; x += lw) c.drawImage(L.c, x, baseY, lw + 1, lh);
      if (baseY + lh < h) { c.fillStyle = '#06040f'; c.fillRect(0, baseY + lh - 1, w, h - baseY - lh + 1); }
    }
    // 안개
    const fg = c.createLinearGradient(0, h * 0.5, 0, h);
    fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, th.fog);
    c.fillStyle = fg; c.fillRect(0, h * 0.5, w, h * 0.5);
    // 비
    if (this.rain.length) {
      c.strokeStyle = 'rgba(170,200,255,0.22)'; c.lineWidth = Math.max(1, this.dpr);
      c.beginPath();
      const sp = dt * 1.4;
      for (const r of this.rain) {
        r[1] += sp * r[2]; r[0] -= sp * r[2] * 0.15;
        if (r[1] > 1) { r[1] -= 1; r[0] = Math.random(); }
        if (r[0] < 0) r[0] += 1;
        const x = ((r[0] * w - cam.x * cam.s * 0.6) % w + w) % w, y = r[1] * h;
        c.moveTo(x, y); c.lineTo(x - 4 * this.dpr, y + 18 * r[2] * this.dpr);
      }
      c.stroke();
    }
  }

  // ---------- 타일 청크 ----------
  chunk(cx, cy) {
    const key = cx + ',' + cy;
    let ch = this.chunks.get(key);
    if (ch) { this.chunks.delete(key); this.chunks.set(key, ch); return ch; }
    const rs = Math.min(this.cam.s, 2);
    ch = document.createElement('canvas');
    ch.width = ch.height = Math.ceil(CPX * rs);
    const c = ch.getContext('2d');
    c.scale(rs, rs); c.translate(-cx * CPX, -cy * CPX);
    this.paintTiles(c, cx * CH, cy * CH, CH, CH);
    this.chunks.set(key, ch);
    if (this.chunks.size > 28) this.chunks.delete(this.chunks.keys().next().value);
    return ch;
  }
  paintTiles(c, x0, y0, nw, nh) {
    const w = this.world, th = this.theme;
    const S = (x, y) => y < 0 || y >= w.H || w.at(x, y) === T.SOLID;
    const edges = new Path2D(), gl = new Path2D(), spikes = new Path2D(), ow = new Path2D();
    for (let y = y0; y < y0 + nh; y++) for (let x = x0; x < x0 + nw; x++) {
      const t = w.at(x, y);
      if (y < 0 || y >= w.H) continue;
      const px = x * TS, py = y * TS;
      if (t === T.SOLID) {
        c.fillStyle = '#07061a'; c.fillRect(px, py, TS, TS);
        const deep = S(x - 1, y) && S(x + 1, y) && S(x, y - 1) && S(x, y + 1);
        if (deep) {
          const r = hash2(x, y);
          if (r < 0.22) {
            c.globalAlpha = 0.18 + r; c.fillStyle = th.win[Math.floor(r * 50) % 3];
            c.fillRect(px + 6 + (r * 40 % 10), py + 8, 7, 9);
            if (r < 0.08) c.fillRect(px + 19, py + 8, 7, 9);
            c.globalAlpha = 1;
          } else if (r > 0.9) {
            c.fillStyle = '#0e0b26'; c.fillRect(px + 2, py + 2, TS - 4, TS - 4);
          }
        } else {
          c.fillStyle = '#0d0b24'; c.fillRect(px + 3, py + 3, TS - 6, TS - 6);
        }
        if (!S(x, y - 1)) { edges.moveTo(px, py); edges.lineTo(px + TS, py); }
        if (!S(x, y + 1)) { edges.moveTo(px, py + TS); edges.lineTo(px + TS, py + TS); }
        if (!S(x - 1, y) && x > 0) { edges.moveTo(px, py); edges.lineTo(px, py + TS); }
        if (!S(x + 1, y) && x < w.W - 1) { edges.moveTo(px + TS, py); edges.lineTo(px + TS, py + TS); }
      } else if (t === T.GLASS) {
        c.fillStyle = 'rgba(255,60,120,0.16)'; c.fillRect(px, py, TS, TS);
        gl.rect(px + 1, py + 1, TS - 2, TS - 2);
        gl.moveTo(px + 4, py + TS - 4); gl.lineTo(px + 14, py + 4);
      } else if (t === T.ONEWAY) {
        c.fillStyle = '#0d0b24'; c.fillRect(px, py, TS, 7);
        ow.moveTo(px, py + 0.5); ow.lineTo(px + TS, py + 0.5);
      } else if (t === T.SPIKE || t === T.SPIKED) {
        const up = t === T.SPIKE;
        for (let k = 0; k < 3; k++) {
          const bx = px + k * TS / 3;
          if (up) { spikes.moveTo(bx, py + TS); spikes.lineTo(bx + TS / 6, py + TS * 0.4); spikes.lineTo(bx + TS / 3, py + TS); }
          else { spikes.moveTo(bx, py); spikes.lineTo(bx + TS / 6, py + TS * 0.6); spikes.lineTo(bx + TS / 3, py); }
        }
      }
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    const neon = (path, col, wide = 7) => {
      c.strokeStyle = col;
      c.globalAlpha = 0.14; c.lineWidth = wide; c.stroke(path);
      c.globalAlpha = 0.35; c.lineWidth = wide * 0.45; c.stroke(path);
      c.globalAlpha = 1; c.lineWidth = 1.6; c.stroke(path);
    };
    neon(edges, th.edge);
    c.globalAlpha = 0.6; c.strokeStyle = '#ffffff'; c.lineWidth = 0.6; c.stroke(edges); c.globalAlpha = 1;
    neon(gl, '#ff4d8d', 5);
    neon(ow, th.edge2, 6);
    c.fillStyle = 'rgba(255,40,80,0.35)'; c.fill(spikes);
    neon(spikes, '#ff2b55', 6);
  }
  drawTiles() {
    const cam = this.cam, s = cam.s;
    const vw = this.w / s, vh = this.h / s;
    const x0 = Math.floor((cam.x - vw / 2) / CPX), x1 = Math.floor((cam.x + vw / 2) / CPX);
    const y0 = Math.floor((cam.y - vh / 2) / CPX), y1 = Math.floor((cam.y + vh / 2) / CPX);
    const maxCx = Math.ceil(this.world.W / CH), maxCy = Math.ceil(this.world.H / CH);
    const c = this.ctx;
    for (let cy = Math.max(0, y0); cy <= Math.min(maxCy - 1, y1); cy++) for (let cx = Math.max(0, x0); cx <= Math.min(maxCx - 1, x1); cx++) {
      c.drawImage(this.chunk(cx, cy), cx * CPX, cy * CPX, CPX, CPX);
    }
  }

  // ---------- 월드 변환 ----------
  beginWorld(shx, shy) {
    const c = this.ctx, cam = this.cam;
    c.setTransform(cam.s, 0, 0, cam.s, Math.round(this.w / 2 - cam.x * cam.s + shx * this.dpr), Math.round(this.h / 2 - cam.y * cam.s + shy * this.dpr));
  }
  endWorld() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); }
  inView(x, y, m = 80) {
    const cam = this.cam, hw = this.w / cam.s / 2 + m, hh = this.h / cam.s / 2 + m;
    return Math.abs(x - cam.x) < hw && Math.abs(y - cam.y) < hh;
  }

  // ---------- 오브젝트 ----------
  drawProps(g) {
    const c = this.ctx, t = this.time, th = this.theme, lv = this.lv;
    c.globalCompositeOperation = 'lighter';
    for (const a of lv.anchors) {
      if (!this.inView(a.x, a.y)) continue;
      const hi = g.aimHi && g.aimHi.x === a.x && g.aimHi.y === a.y;
      this.dg(a.x, a.y, hi ? 34 : 24, th.edge2, 0.5 + Math.sin(t * 4 + a.x) * 0.15);
    }
    c.globalCompositeOperation = 'source-over';
    c.lineWidth = 2;
    for (const a of lv.anchors) {
      if (!this.inView(a.x, a.y)) continue;
      c.strokeStyle = th.edge2; c.beginPath(); c.arc(a.x, a.y, 8, 0, TAU); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(a.x, a.y, 2.5, 0, TAU); c.fill();
      c.save(); c.translate(a.x, a.y); c.rotate(t * 1.5);
      c.strokeStyle = th.edge2; c.globalAlpha = 0.6;
      for (let k = 0; k < 4; k++) { c.rotate(TAU / 4); c.beginPath(); c.moveTo(11, 0); c.lineTo(15, 0); c.stroke(); }
      c.restore();
    }
    // 체크포인트
    lv.checkpoints.forEach((cp, i) => {
      if (!this.inView(cp.x, cp.y, 120) || cp.start) return;
      const on = g.cpIndex >= i;
      const col = on ? '#39ff14' : '#5a5a7a';
      const by = cp.y + P.h / 2;
      c.fillStyle = '#14122c'; c.fillRect(cp.x - 2, by - 56, 4, 56);
      c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(cp.x - 2, by - 56, 4, 56);
      c.globalCompositeOperation = 'lighter';
      this.dg(cp.x, by - 60, on ? 30 : 14, col, on ? 0.8 : 0.4);
      if (on) { c.fillStyle = 'rgba(57,255,20,0.08)'; c.fillRect(cp.x - 6, by - 260, 12, 200); }
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = col; c.save(); c.translate(cp.x, by - 60); c.rotate(t * (on ? 2 : 0.5)); c.fillRect(-5, -5, 10, 10); c.restore();
    });
    // 출구 포털
    const ex = g.exitPos;
    if (ex && this.inView(ex.x, ex.y, 150)) {
      const cx = ex.x, cy = ex.y - 18;
      c.globalCompositeOperation = 'lighter';
      this.dg(cx, cy, 90, th.edge, 0.5);
      c.globalCompositeOperation = 'source-over';
      c.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        c.strokeStyle = k === 1 ? th.edge2 : th.edge;
        c.beginPath(); c.ellipse(cx, cy, 22 + k * 7, 44 + k * 6, 0, t * (1 + k) * (k % 2 ? -1 : 1), t * (1 + k) * (k % 2 ? -1 : 1) + 4.4); c.stroke();
      }
      c.fillStyle = '#fff'; c.globalAlpha = 0.6 + Math.sin(t * 6) * 0.2;
      c.beginPath(); c.ellipse(cx, cy, 10, 36, 0, 0, TAU); c.fill(); c.globalAlpha = 1;
    }
    const fin = lv.finish;
    if (fin && this.inView(fin.x, fin.y, 200)) {
      const by = fin.y + P.h / 2;
      for (let k = 0; k < 10; k++) for (let j = 0; j < 2; j++) {
        c.fillStyle = (k + j) % 2 ? '#ffffff' : '#111';
        c.fillRect(fin.x - 8 + j * 8, by - (k + 1) * 16, 8, 16);
      }
      c.globalCompositeOperation = 'lighter';
      this.dg(fin.x, by - 80, 100, '#ffe600', 0.35);
      c.globalCompositeOperation = 'source-over';
    }
    // 부스트 패드
    for (const b of lv.boosts) {
      if (!this.inView(b.x, b.y)) continue;
      c.globalCompositeOperation = 'lighter';
      this.dg(b.x, b.y - 4, 30, '#ffe600', 0.5);
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = '#ffe600'; c.lineWidth = 2.5;
      for (let k = 0; k < 3; k++) {
        const o = ((t * 3 + k / 3) % 1) * 8;
        c.globalAlpha = 0.4 + k * 0.3;
        c.beginPath(); c.moveTo(b.x - 14 + k * 9 + o, b.y - 12); c.lineTo(b.x - 8 + k * 9 + o, b.y - 6); c.lineTo(b.x - 14 + k * 9 + o, b.y); c.stroke();
      }
      c.globalAlpha = 1;
    }
    // 회복
    for (const hp of g.healthLeft) {
      if (!this.inView(hp.x, hp.y)) continue;
      const y = hp.y + Math.sin(t * 3 + hp.x) * 4;
      c.globalCompositeOperation = 'lighter'; this.dg(hp.x, y, 26, '#39ff14', 0.6); c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#d8ffd0'; c.fillRect(hp.x - 7, y - 2.5, 14, 5); c.fillRect(hp.x - 2.5, y - 7, 5, 14);
    }
    // 튜토리얼 힌트
    if (lv.hints.length) this.drawHints(g);
  }
  drawHints(g) {
    const c = this.ctx;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const h of this.lv.hints) {
      if (!this.inView(h.x, h.y, 200)) continue;
      const info = g.hintText(h.k);
      if (!info) continue;
      c.font = '700 13px "Noto Sans KR", sans-serif';
      const w1 = c.measureText(info.label).width;
      c.font = '700 12px Orbitron, sans-serif';
      const w2 = c.measureText(info.key).width;
      const W = Math.max(w1, w2 + 16) + 26, H = 50;
      const x = h.x - W / 2 + 40, y = h.y - H / 2;
      c.fillStyle = 'rgba(8,6,24,0.78)'; c.strokeStyle = this.theme.edge; c.lineWidth = 1.2;
      c.beginPath(); c.roundRect(x, y, W, H, 8); c.fill(); c.stroke();
      c.fillStyle = this.theme.edge; c.fillRect(x + W / 2 - w2 / 2 - 8, y + 7, w2 + 16, 18);
      c.fillStyle = '#05030f'; c.fillText(info.key, x + W / 2, y + 16.5);
      c.font = '700 13px "Noto Sans KR", sans-serif';
      c.fillStyle = '#e8f4ff'; c.fillText(info.label, x + W / 2, y + 37);
    }
    c.textBaseline = 'alphabetic';
  }

  drawEnemies(en) {
    const c = this.ctx, t = this.time;
    for (const e of en.list) {
      if (e.type === 'pod' || e.type === 'core') continue;
      if (!this.inView(e.x, e.y)) continue;
      if (!e.alive) {
        if (e.die >= 1) continue;
        c.globalAlpha = 1 - e.die;
        c.strokeStyle = '#ff2b55'; c.lineWidth = 2;
        c.beginPath(); c.arc(e.x, e.y, e.r * (1 + e.die * 2), 0, TAU); c.stroke();
        c.globalAlpha = 1;
        continue;
      }
      const red = '#ff2b55';
      c.globalCompositeOperation = 'lighter';
      this.dg(e.x, e.y, e.r * 2.6 + e.charge * 20, e.charge > 0 ? '#ff8a1f' : red, 0.35 + e.charge * 0.5);
      c.globalCompositeOperation = 'source-over';
      c.lineWidth = 1.8; c.strokeStyle = red; c.fillStyle = '#12081a';
      if (e.type === 'walker') {
        const ph = t * 10 + e.id;
        c.beginPath();
        c.moveTo(e.x - 6, e.y + 4); c.lineTo(e.x - 9 + Math.sin(ph) * 4, e.y + e.r);
        c.moveTo(e.x + 6, e.y + 4); c.lineTo(e.x + 9 - Math.sin(ph) * 4, e.y + e.r);
        c.stroke();
        c.beginPath(); c.moveTo(e.x - 13, e.y + 5); c.lineTo(e.x - 9, e.y - 11); c.lineTo(e.x + 9, e.y - 11); c.lineTo(e.x + 13, e.y + 5); c.closePath(); c.fill(); c.stroke();
        const ex = e.x + Math.sin(t * 2 + e.id) * 5;
        c.fillStyle = '#ffd0d8'; c.fillRect(ex - 3, e.y - 5, 6, 3);
      } else if (e.type === 'drone') {
        c.beginPath(); c.arc(e.x, e.y, e.r - 2, 0, TAU); c.fill(); c.stroke();
        c.beginPath(); c.ellipse(e.x, e.y - e.r + 1, e.r + 6 + Math.sin(t * 40) * 2, 2, 0, 0, TAU); c.stroke();
        c.fillStyle = e.charge > 0 ? '#ffe600' : '#ffd0d8';
        c.beginPath(); c.arc(e.x, e.y, 3.5 + e.charge * 3, 0, TAU); c.fill();
      } else if (e.type === 'turret') {
        c.fillRect(e.x - 12, e.y - 16, 24, 10); c.strokeRect(e.x - 12, e.y - 16, 24, 10);
        c.beginPath(); c.arc(e.x, e.y - 2, 9, 0, TAU); c.fill(); c.stroke();
        c.lineWidth = 4; c.beginPath(); c.moveTo(e.x, e.y - 2); c.lineTo(e.x + Math.cos(e.ang) * 18, e.y - 2 + Math.sin(e.ang) * 18); c.stroke();
        c.fillStyle = e.charge > 0 ? '#ffe600' : '#ffd0d8';
        c.beginPath(); c.arc(e.x, e.y - 2, 3 + e.charge * 3, 0, TAU); c.fill();
      }
      if (e.flash > 0) { c.globalAlpha = e.flash * 3; c.fillStyle = '#fff'; c.beginPath(); c.arc(e.x, e.y, e.r, 0, TAU); c.fill(); c.globalAlpha = 1; }
    }
    if (en.boss) this.drawBoss(en);
  }
  drawBoss(en) {
    const c = this.ctx, b = en.boss, t = this.time;
    if (b.dead) return;
    const core = en.core;
    // 포드 연결선
    c.lineWidth = 1.5;
    for (const p of en.pods) {
      if (!p.alive) continue;
      c.strokeStyle = 'rgba(0,240,255,0.35)'; c.setLineDash([4, 6]);
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(p.x, p.y); c.stroke();
    }
    c.setLineDash([]);
    c.globalCompositeOperation = 'lighter';
    this.dg(b.x, b.y, 140, b.stun > 0 ? '#ffe600' : '#ff2b55', 0.4 + Math.sin(t * 3) * 0.1);
    for (const p of en.pods) if (p.alive) this.dg(p.x, p.y, 40, '#00f0ff', 0.7);
    c.globalCompositeOperation = 'source-over';
    // 포드
    for (const p of en.pods) {
      if (!p.alive) continue;
      c.save(); c.translate(p.x, p.y); c.rotate(t * 3);
      c.fillStyle = '#071a24'; c.strokeStyle = '#00f0ff'; c.lineWidth = 2;
      c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * TAU / 6; c.lineTo(Math.cos(a) * 15, Math.sin(a) * 15); } c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#e8ffff'; c.beginPath(); c.arc(0, 0, 4, 0, TAU); c.fill();
      c.restore();
    }
    // 코어
    c.save(); c.translate(b.x, b.y);
    c.fillStyle = '#14040c'; c.strokeStyle = b.stun > 0 ? '#ffe600' : '#ff2b55'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 34, 0, TAU); c.fill(); c.stroke();
    c.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      c.beginPath(); c.arc(0, 0, 44 + k * 8, t * (k + 1) * 0.8 + k, t * (k + 1) * 0.8 + k + 2.2); c.stroke();
    }
    const eye = b.stun > 0 ? '#ffe600' : '#ffd0d8';
    c.fillStyle = eye; c.beginPath(); c.arc(0, 0, 10 + Math.sin(t * 5) * 2, 0, TAU); c.fill();
    if (core.shield) {
      c.strokeStyle = 'rgba(255,43,214,' + (0.5 + Math.sin(t * 6) * 0.2) + ')'; c.lineWidth = 2;
      c.beginPath(); for (let k = 0; k <= 8; k++) { const a = k * TAU / 8 + t * 0.4; c.lineTo(Math.cos(a) * 62, Math.sin(a) * 62); } c.stroke();
      c.fillStyle = 'rgba(255,43,214,0.06)'; c.fill();
    } else {
      // 노출 상태: 약점 표시
      c.strokeStyle = '#ffe600'; c.lineWidth = 2;
      const k = 1 + Math.sin(t * 10) * 0.08;
      c.beginPath(); c.arc(0, 0, 48 * k, 0, TAU); c.stroke();
    }
    if (b.flash > 0) { c.globalAlpha = b.flash * 2.5; c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 36, 0, TAU); c.fill(); c.globalAlpha = 1; }
    c.restore();
  }
  drawShots(en) {
    const c = this.ctx;
    c.globalCompositeOperation = 'lighter';
    for (const b of en.bullets) {
      if (!this.inView(b.x, b.y, 20)) continue;
      this.dg(b.x, b.y, b.k ? 22 : 16, b.k ? '#ff2b55' : '#ff8a1f', 0.9);
    }
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#fff5e8';
    for (const b of en.bullets) {
      if (!this.inView(b.x, b.y, 20)) continue;
      c.beginPath(); c.arc(b.x, b.y, b.k ? 4 : 3, 0, TAU); c.fill();
    }
    for (const l of en.lasers) {
      const a = en.laserAngle(l);
      const x2 = l.x + Math.cos(a) * 1600, y2 = l.y + Math.sin(a) * 1600;
      if (l.t <= l.tele) {
        c.strokeStyle = 'rgba(255,43,85,' + (0.3 + Math.sin(l.t * 40) * 0.25) + ')'; c.lineWidth = 2; c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(x2, y2); c.stroke(); c.setLineDash([]);
      } else {
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,43,85,0.25)'; c.lineWidth = 30; c.beginPath(); c.moveTo(l.x, l.y); c.lineTo(x2, y2); c.stroke();
        c.strokeStyle = '#ff2b55'; c.lineWidth = 12; c.stroke();
        c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke();
      }
    }
  }

  // ---------- 플레이어 ----------
  scarfStep(p, dt) {
    const nx = p.x - p.face * 3, ny = p.y - 8;
    if (!p.scarf) { p.scarf = []; for (let i = 0; i < 7; i++) p.scarf.push([nx, ny, nx, ny]); }
    const s = p.scarf;
    s[0][0] = nx; s[0][1] = ny;
    const wind = Math.sin(this.time * 3 + p.slot) * 30;
    for (let i = 1; i < s.length; i++) {
      const q = s[i];
      const vx = (q[0] - q[2]) * 0.9, vy = (q[1] - q[3]) * 0.9;
      q[2] = q[0]; q[3] = q[1];
      q[0] += vx + (-p.face * 40 + wind) * dt * dt * 30; q[1] += vy + 300 * dt * dt * 2;
    }
    for (let it = 0; it < 2; it++) for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, k = (d - 4) / d;
      if (i === 1) { b[0] -= dx * k; b[1] -= dy * k; } else { a[0] += dx * k * 0.5; a[1] += dy * k * 0.5; b[0] -= dx * k * 0.5; b[1] -= dy * k * 0.5; }
    }
  }
  drawRope(p) {
    const c = this.ctx, h = p.hand;
    let tx, ty, show = false;
    if (p.hook === HOOK.FLY || p.hook === HOOK.ATTACH || p.hook === HOOK.SNATCH) { tx = p.hx; ty = p.hy; show = true; }
    else if (p.retract > 0) { const k = p.retract / 0.12; tx = h.x + (p.rx - h.x) * k; ty = h.y + (p.ry - h.y) * k; show = true; }
    if (!show) return;
    c.lineCap = 'round';
    c.strokeStyle = p.color; c.globalAlpha = 0.25; c.lineWidth = 6;
    c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(tx, ty); c.stroke();
    c.globalAlpha = 1; c.lineWidth = 2.2; c.setLineDash([5, 3]); c.lineDashOffset = -this.time * 60;
    c.stroke(); c.setLineDash([]);
    c.strokeStyle = '#fff'; c.lineWidth = 0.8; c.stroke();
    const a = Math.atan2(ty - h.y, tx - h.x);
    c.save(); c.translate(tx, ty); c.rotate(a);
    c.fillStyle = '#fff'; c.strokeStyle = p.color; c.lineWidth = 2;
    c.beginPath(); c.moveTo(5, 0); c.lineTo(-4, -5); c.lineTo(-1, 0); c.lineTo(-4, 5); c.closePath(); c.fill(); c.stroke();
    c.restore();
    if (p.hook === HOOK.ATTACH) { c.globalCompositeOperation = 'lighter'; this.dg(tx, ty, 16, p.color, 0.8); c.globalCompositeOperation = 'source-over'; }
  }
  drawPlayer(p, dt, ghost = false) {
    const c = this.ctx, t = this.time;
    if (p.dead) return;
    if (!this.inView(p.x, p.y)) { this.scarfStep(p, dt); return; }
    const col = p.color, f = p.face;
    // 잔상
    if (p.trail.length > 2) {
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < p.trail.length; i += 2) {
        const a = (i / p.trail.length) * 0.5;
        c.globalAlpha = a; c.fillStyle = col;
        c.beginPath(); c.roundRect(p.trail[i] - 7, p.trail[i + 1] - 13, 14, 26, 6); c.fill();
      }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    this.drawRope(p);
    let alpha = ghost ? 0.4 : 1;
    if (p.inv > 0 && !(p.dashT > 0) && p.hook !== HOOK.SNATCH && Math.floor(t * 18) % 2) alpha *= 0.35;
    c.globalAlpha = alpha;
    this.scarfStep(p, dt);
    // 스카프
    c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(p.scarf[0][0], p.scarf[0][1]);
    for (let i = 1; i < p.scarf.length; i++) c.lineTo(p.scarf[i][0], p.scarf[i][1]);
    c.stroke();
    // 다리
    const x = p.x, y = p.y + (p.land > 0 ? 2 : 0);
    let l1 = 0, l2 = 0, k1 = 0, k2 = 0;
    if (p.ground && Math.abs(p.vx) > 20) { l1 = Math.sin(p.anim) * 7; l2 = -l1; k1 = Math.max(0, Math.cos(p.anim)) * 4; k2 = Math.max(0, -Math.cos(p.anim)) * 4; }
    else if (!p.ground) { l1 = -4 * f; l2 = 5 * f; k1 = 5; k2 = 2; }
    if (p.wall) { l1 = p.wall * 4; l2 = p.wall * 6; k1 = 3; k2 = 6; }
    c.strokeStyle = '#1b1838'; c.lineWidth = 4.5;
    c.beginPath(); c.moveTo(x - 3, y + 4); c.lineTo(x - 3 + l1 * f, y + 14 - k1); c.moveTo(x + 3, y + 4); c.lineTo(x + 3 + l2 * f, y + 14 - k2); c.stroke();
    c.strokeStyle = col; c.lineWidth = 1.3; c.stroke();
    // 몸통(코트)
    const lean = clamp(p.vx / 900, -0.25, 0.25);
    c.save(); c.translate(x, y); c.rotate(lean);
    c.fillStyle = '#0c0a1e'; c.strokeStyle = col; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(-6, -8); c.lineTo(6, -8); c.lineTo(8, 6); c.lineTo(-f * 10, 8); c.lineTo(-8, 6); c.closePath(); c.fill(); c.stroke();
    // 머리 + 후드
    c.beginPath(); c.moveTo(-f * 10, -9); c.quadraticCurveTo(-f * 8, -20, f * 1, -19); c.quadraticCurveTo(f * 8, -18, f * 7, -11); c.lineTo(f * 4, -7); c.lineTo(-f * 5, -7); c.closePath(); c.fill(); c.stroke();
    // 바이저
    c.strokeStyle = '#ffffff'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(f * 1, -13); c.lineTo(f * 6.5, -13); c.stroke();
    c.restore();
    c.globalCompositeOperation = 'lighter';
    this.dg(x + f * 4, y - 13, 9, col, 0.9 * alpha);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
    // 기계 팔
    const sh = { x: x + f * 2, y: y - 5 };
    let hx, hy;
    if (p.hook && p.hook !== HOOK.NONE) {
      const a = Math.atan2(p.hy - sh.y, p.hx - sh.x);
      hx = sh.x + Math.cos(a) * 10; hy = sh.y + Math.sin(a) * 10;
    } else if (p.dashT > 0) { hx = sh.x + f * 10; hy = sh.y + 2; }
    else { hx = sh.x + f * 6 + Math.sin(p.anim) * 2; hy = sh.y + 8; }
    c.strokeStyle = '#1b1838'; c.lineWidth = 5; c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(hx, hy); c.stroke();
    c.strokeStyle = col; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(hx, hy, 2.2, 0, TAU); c.fill();
    c.globalAlpha = 1;
  }
  nameTag(p) {
    const c = this.ctx;
    c.font = '700 11px "Noto Sans KR", sans-serif'; c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.5)';
    const w = c.measureText(p.name).width + 10;
    c.fillRect(p.x - w / 2, p.y - 44, w, 15);
    c.fillStyle = p.color; c.fillText(p.name, p.x, p.y - 33);
  }
  drawGhost(gh) {
    const c = this.ctx;
    c.globalAlpha = 0.35;
    c.strokeStyle = '#e8f4ff'; c.fillStyle = 'rgba(232,244,255,0.15)'; c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(gh.x - 7, gh.y - 14, 14, 28, 6); c.fill(); c.stroke();
    if (gh.hx != null) { c.setLineDash([4, 4]); c.beginPath(); c.moveTo(gh.x, gh.y - 3); c.lineTo(gh.hx, gh.hy); c.stroke(); c.setLineDash([]); }
    c.globalAlpha = 1;
  }
  drawReticle(x, y, col, lock) {
    const c = this.ctx, t = this.time;
    c.strokeStyle = col; c.lineWidth = 1.5;
    const r = lock ? 14 + Math.sin(t * 10) * 2 : 9;
    c.save(); c.translate(x, y); if (lock) c.rotate(t * 2);
    for (let k = 0; k < 4; k++) {
      c.rotate(TAU / 4);
      c.beginPath(); c.moveTo(r, -4); c.lineTo(r, 4); c.stroke();
    }
    c.restore();
  }
}
