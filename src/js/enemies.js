// 적 / 탄환 / 레이저 / 보스. 호스트가 AI를 계산하고, 참가자는 스냅샷을 보간한다.
import { TS, T } from './config.js';
import { TAU, segDist2, lerp } from './util.js';

const R = { walker: 12, drone: 13, turret: 14, pod: 15, core: 36 };
const ACT = 760;

export class Enemies {
  constructor(lv, host) {
    this.host = host;
    this.list = [];
    this.byId = new Map();
    this.bullets = [];
    this.lasers = [];
    this.boss = null;
    this.spawnSeq = 2000;
    this.emit = () => {};
    for (const e of lv.enemies) {
      if (e.type === 'boss') { this.makeBoss(e.x, e.y); continue; }
      this.add({ id: e.id, type: e.type, x: e.x, y: e.y });
    }
  }
  add(o) {
    const e = Object.assign({ hx: o.x, hy: o.y, tx: o.x, ty: o.y, vx: 0, vy: 0, r: R[o.type], alive: true, t: Math.random() * 6, cd: 1.2 + Math.random(), charge: 0, dir: Math.random() < 0.5 ? -1 : 1, ang: Math.PI / 2, die: 0, flash: 0 }, o);
    this.list.push(e); this.byId.set(e.id, e);
    return e;
  }
  makeBoss(x, y) {
    const b = this.boss = { x, y, hx: x, hy: y, hp: 9, max: 9, phase: 1, stun: 0, rot: 0, pods: [1, 1, 1], atk: 2.5, seq: 0, inv: 0, dead: false, flash: 0, t: 0, ty: y, tx: x };
    this.core = this.add({ id: 999, type: 'core', x, y, shield: true });
    this.pods = [0, 1, 2].map((i) => this.add({ id: 1000 + i, type: 'pod', x, y }));
    this.placePods();
    return b;
  }
  placePods() {
    const b = this.boss;
    for (let i = 0; i < 3; i++) {
      const p = this.pods[i];
      const a = b.rot + i * TAU / 3;
      p.x = b.x + Math.cos(a) * 125; p.y = b.y + Math.sin(a) * 125;
      p.alive = !!b.pods[i] && !b.dead;
    }
    this.core.x = b.x; this.core.y = b.y;
    this.core.shield = b.stun <= 0;
    this.core.alive = !b.dead;
  }

  nearest(e, players) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.dead) continue;
      const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: Math.sqrt(bd) } : null;
  }

  update(dt, g) {
    const w = g.world, players = g.allPlayers();
    if (this.host) {
      const outB = [];
      for (const e of this.list) {
        if (!e.alive || e.type === 'pod' || e.type === 'core') continue;
        const n = this.nearest(e, players);
        if (!n || n.d > ACT) { e.charge = 0; continue; }
        e.t += dt;
        if (e.type === 'walker') {
          e.vy += 1900 * dt; if (e.vy > 900) e.vy = 900;
          e.vx = e.dir * 78;
          const ahead = Math.floor((e.x + e.dir * (e.r + 3)) / TS);
          const foot = Math.floor((e.y + e.r + 4) / TS);
          const ft = w.at(ahead, foot);
          if (w.solidAt(ahead, Math.floor(e.y / TS)) || (ft !== T.SOLID && ft !== T.GLASS && ft !== T.ONEWAY)) e.dir *= -1;
          e.x += e.vx * dt;
          const ny = e.y + e.vy * dt;
          if (w.solidAt(Math.floor(e.x / TS), Math.floor((ny + e.r) / TS)) || w.at(Math.floor(e.x / TS), Math.floor((ny + e.r) / TS)) === T.ONEWAY) { e.y = Math.floor((ny + e.r) / TS) * TS - e.r; e.vy = 0; } else e.y = ny;
          if (e.y > w.ph + 100) { e.alive = false; this.emit('ek', { id: e.id, by: -1 }); }
        } else if (e.type === 'drone') {
          e.x += Math.max(-1, Math.min(1, (n.p.x - e.x) / 100)) * 38 * dt;
          if (Math.abs(e.x - e.hx) > 90) e.x = e.hx + Math.sign(e.x - e.hx) * 90;
          e.y = e.hy + Math.sin(e.t * 2.1) * 12;
          this.shooter(e, n, dt, w, 470, () => {
            const a = Math.atan2(n.p.y - e.y, n.p.x - e.x);
            outB.push(this.fire(e.x, e.y, a, 330, 0));
          }, 1.9);
        } else if (e.type === 'turret') {
          const want = Math.atan2(n.p.y - e.y, n.p.x - e.x);
          let da = want - e.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
          e.ang += da * Math.min(1, dt * 4);
          this.shooter(e, n, dt, w, 540, () => {
            for (let k = -1; k <= 1; k++) outB.push(this.fire(e.x + Math.cos(e.ang) * 14, e.y + Math.sin(e.ang) * 14, e.ang + k * 0.2, 300, 0));
          }, 2.5);
        }
      }
      if (this.boss && !this.boss.dead) this.bossAI(dt, g, players, outB);
      if (outB.length) this.emit('b', outB);
    } else {
      // 참가자: 보간
      const k = 1 - Math.exp(-14 * dt);
      for (const e of this.list) {
        if (e.type === 'pod' || e.type === 'core') continue;
        e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
      }
      if (this.boss) {
        const b = this.boss;
        b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k;
        b.rot += b.rotV * dt || 0;
        this.placePods();
      }
    }
    for (const e of this.list) { if (e.flash > 0) e.flash -= dt; if (!e.alive && e.die < 1) e.die += dt * 3; }
    if (this.boss && this.boss.flash > 0) this.boss.flash -= dt;
    this.updateShots(dt, g);
  }
  shooter(e, n, dt, w, range, fire, cdBase) {
    if (n.d < range && w.los(e.x, e.y, n.p.x, n.p.y)) {
      e.cd -= dt;
      e.charge = e.cd < 0.5 ? 1 - e.cd / 0.5 : 0;
      if (e.cd <= 0) { fire(); e.cd = cdBase + Math.random() * 0.7; e.charge = 0; }
    } else { e.charge = 0; if (e.cd < 0.6) e.cd = 0.6; }
  }
  fire(x, y, a, spd, k) {
    const b = [Math.round(x), Math.round(y), Math.round(Math.cos(a) * spd), Math.round(Math.sin(a) * spd), k];
    this.spawnBullet(b);
    return b;
  }
  spawnBullet(b) { this.bullets.push({ x: b[0], y: b[1], vx: b[2], vy: b[3], k: b[4], life: 5, r: b[4] ? 7 : 5 }); }

  // ---------- 보스 ----------
  bossAI(dt, g, players, outB) {
    const b = this.boss;
    b.t += dt;
    if (b.inv > 0) b.inv -= dt;
    const rotV = b.stun > 0 ? 0.25 : 0.75 + b.phase * 0.25;
    b.rotV = rotV;
    b.rot += rotV * dt;
    if (b.stun > 0) {
      b.stun -= dt;
      b.y = lerp(b.y, b.hy + 120, 1 - Math.exp(-3 * dt));
      b.x = lerp(b.x, b.hx, 1 - Math.exp(-2 * dt));
      if (b.stun <= 0) { b.pods = [1, 1, 1]; b.atk = 1.2; this.emit('bev', { k: 'regen' }); g.bossEvent('regen'); }
    } else {
      b.y = lerp(b.y, b.hy + Math.sin(b.t * 0.9) * 26, 1 - Math.exp(-3 * dt));
      b.x = lerp(b.x, b.hx + Math.sin(b.t * 0.5) * 220, 1 - Math.exp(-1.5 * dt));
      b.atk -= dt;
      if (b.atk <= 0) this.bossAttack(g, players, outB);
    }
    this.placePods();
  }
  bossAttack(g, players, outB) {
    const b = this.boss;
    const pats = b.phase === 1 ? ['burst', 'ring', 'burst'] : b.phase === 2 ? ['laser', 'ring', 'burst', 'ring'] : ['spiral', 'laser', 'summon', 'ring', 'burst'];
    const p = pats[b.seq++ % pats.length];
    const alive = players.filter((q) => !q.dead);
    const tgt = alive[Math.floor(Math.random() * alive.length)] || { x: b.x, y: b.y + 200 };
    if (p === 'burst') {
      const a = Math.atan2(tgt.y - b.y, tgt.x - b.x);
      for (let k = -2; k <= 2; k++) outB.push(this.fire(b.x, b.y, a + k * 0.13, 380, 1));
      b.atk = 1.5;
    } else if (p === 'ring') {
      const n = 10 + b.phase * 4, off = Math.random() * TAU;
      for (let k = 0; k < n; k++) outB.push(this.fire(b.x, b.y, off + k * TAU / n, 210, 1));
      b.atk = 2.0;
    } else if (p === 'spiral') {
      const off = Math.random() * TAU;
      for (let k = 0; k < 28; k++) outB.push(this.fire(b.x, b.y, off + k * 0.45, 170 + k * 4, 1));
      b.atk = 2.2;
    } else if (p === 'laser') {
      const left = tgt.x < b.x;
      const a0 = left ? Math.PI * 0.95 : Math.PI * 0.05, a1 = left ? Math.PI * 0.2 : Math.PI * 0.8;
      const lz = { x: Math.round(b.x), y: Math.round(b.y), a0, a1, tele: 0.9, dur: 1.5 };
      this.addLaser(lz); this.emit('lz', lz);
      b.atk = 3.0;
    } else if (p === 'summon') {
      const drones = this.list.filter((e) => e.type === 'drone' && e.alive).length;
      for (let k = 0; k < 2 && drones + k < 3; k++) {
        const d = this.add({ id: this.spawnSeq++, type: 'drone', x: b.x + (k ? 160 : -160), y: b.y + 40 });
        d.cd = 1.6;
      }
      b.atk = 1.4;
    }
    g.bossEvent('attack');
  }
  addLaser(l) { this.lasers.push({ ...l, t: 0 }); }
  // 호스트: 낚아채기 판정 적용
  bossHit(id) {
    const b = this.boss;
    if (!b || b.dead) return null;
    if (id >= 1000 && id < 1003) {
      const i = id - 1000;
      if (!b.pods[i]) return null;
      b.pods[i] = 0;
      if (!b.pods[0] && !b.pods[1] && !b.pods[2]) { b.stun = 6.5; return 'stun'; }
      return 'pod';
    }
    if (id === 999) {
      if (b.stun <= 0 || b.inv > 0) return null;
      b.hp--; b.inv = 0.5; b.flash = 0.3;
      if (b.hp <= 0) { b.dead = true; this.placePods(); return 'dead'; }
      const ph = b.hp > 6 ? 1 : b.hp > 3 ? 2 : 3;
      if (ph !== b.phase) { b.phase = ph; b.stun = 0.01; return 'phase'; }
      return 'core';
    }
    return null;
  }

  updateShots(dt, g) {
    const w = g.world, me = g.me;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || w.solidAt(Math.floor(b.x / TS), Math.floor(b.y / TS))) {
        if (b.life > 0) g.fx.burst(b.x, b.y, 4, b.k ? '#ff2b55' : '#ff8a1f', 120, 0.25);
        this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop();
        continue;
      }
      if (me && !me.dead && (b.x - me.x) ** 2 + (b.y - me.y) ** 2 < (b.r + 9) ** 2) {
        if (g.hurt(me, b.x)) { this.bullets[i] = this.bullets[this.bullets.length - 1]; this.bullets.pop(); }
      }
    }
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.t += dt;
      if (l.t > l.tele + l.dur) { this.lasers.splice(i, 1); continue; }
      if (l.t > l.tele && me && !me.dead) {
        const a = this.laserAngle(l);
        if (segDist2(l.x, l.y, l.x + Math.cos(a) * 1600, l.y + Math.sin(a) * 1600, me.x, me.y) < 14 * 14) g.hurt(me, l.x);
      }
    }
    // 접촉 피해
    if (me && !me.dead) {
      for (const e of this.list) {
        if (!e.alive || e.type === 'pod') continue;
        if (e.type === 'core' && !e.shield) continue;
        const rr = e.r + 10;
        if ((e.x - me.x) ** 2 + (e.y - me.y) ** 2 < rr * rr) {
          if (me.dashT > 0 && e.type !== 'core') g.dashKill(me, e);
          else g.hurt(me, e.x);
        }
      }
    }
  }
  laserAngle(l) {
    if (l.t <= l.tele) return l.a0;
    const k = Math.min(1, (l.t - l.tele) / l.dur);
    return l.a0 + (l.a1 - l.a0) * (k * k * (3 - 2 * k));
  }

  // ---------- 네트워크 ----------
  snapshot(players) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive || e.type === 'pod' || e.type === 'core') continue;
      let near = false;
      for (const p of players) if (Math.abs(p.x - e.x) < 1300 && Math.abs(p.y - e.y) < 900) { near = true; break; }
      if (!near) continue;
      out.push([e.id, Math.round(e.x), Math.round(e.y), Math.round(e.charge * 100), Math.round(e.ang * 100), e.type === 'drone' ? 1 : e.type === 'walker' ? 2 : 3]);
    }
    const s = { e: out };
    const b = this.boss;
    if (b) s.b = [Math.round(b.x), Math.round(b.y), b.hp, b.phase, +b.stun.toFixed(2), +b.rot.toFixed(3), b.pods[0] | (b.pods[1] << 1) | (b.pods[2] << 2), b.dead ? 1 : 0, +b.rotV.toFixed(2)];
    return s;
  }
  applySnapshot(s) {
    const TYPES = { 1: 'drone', 2: 'walker', 3: 'turret' };
    for (const [id, x, y, ch, ang, ty] of s.e) {
      let e = this.byId.get(id);
      if (!e) { if (id < 2000) continue; e = this.add({ id, type: TYPES[ty] || 'drone', x, y }); }
      if (!e.alive) continue;
      e.tx = x; e.ty = y; e.charge = ch / 100; e.ang = ang / 100;
    }
    if (s.b && this.boss) {
      const b = this.boss;
      const [x, y, hp, ph, stun, rot, pm, dead, rv] = s.b;
      b.tx = x; b.ty = y;
      if (hp < b.hp) b.flash = 0.3;
      b.hp = hp; b.phase = ph; b.stun = stun; b.rotV = rv;
      let dr = rot - b.rot; if (Math.abs(dr) > 1) b.rot = rot; else b.rot += dr * 0.5;
      b.pods = [pm & 1, (pm >> 1) & 1, (pm >> 2) & 1]; b.dead = !!dead;
      this.placePods();
    }
  }
  kill(id) {
    const e = this.byId.get(id);
    if (e && e.alive && e.type !== 'core') { e.alive = false; e.die = 0; return e; }
    return null;
  }
}
