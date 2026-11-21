// 플레이어 물리: 이동, 점프, 벽 점프, 대시, 와이어(스윙/당기기), 낚아채기 돌진
import { TS, T, P } from './config.js';
import { clamp, sign } from './util.js';

const HW = P.w / 2, HH = P.h / 2;
export const HOOK = { NONE: 0, FLY: 1, ATTACH: 2, SNATCH: 3 };

export class Player {
  constructor(slot, name, color) {
    this.slot = slot; this.name = name; this.color = color;
    this.local = true;
    this.reset(0, 0);
    this.trail = []; // 잔상
    this.scarf = null;
  }
  reset(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.face = 1; this.ground = false; this.wall = 0;
    this.coyote = 0; this.buffer = 0; this.wallCoyote = 0; this.lastWall = 0;
    this.jumpCut = false; this.wjLock = 0;
    this.dashT = 0; this.dashCD = 0; this.dashes = 1; this.dashDX = 0; this.dashDY = 0;
    this.hook = HOOK.NONE; this.hx = 0; this.hy = 0; this.hvx = 0; this.hvy = 0; this.hookD = 0;
    this.ropeLen = 0; this.target = -1; this.snatchT = 0; this.stuck = 0;
    this.retract = 0; this.rx = 0; this.ry = 0;
    this.hp = P.maxHp; this.inv = 0; this.dead = false; this.respawnT = 0;
    this.anim = 0; this.land = 0; this.hurtFlash = 0;
    this.hitWallX = 0;
  }
  get hand() { return { x: this.x + this.face * 5, y: this.y - 3 }; }
  get busy() { return this.dashT > 0 || this.hook === HOOK.SNATCH; }

  moveX(w, dx) {
    if (!dx) return false;
    const s = dx > 0 ? 1 : -1;
    let rem = Math.abs(dx);
    while (rem > 0) {
      const st = rem > 8 ? 8 : rem;
      const nx = this.x + s * st;
      if (w.boxSolid(nx, this.y, HW, HH)) {
        if (s > 0) this.x = Math.floor((nx + HW) / TS) * TS - HW - 0.01;
        else this.x = (Math.floor((nx - HW) / TS) + 1) * TS + HW + 0.01;
        this.hitWallX = s;
        return true;
      }
      this.x = nx; rem -= st;
    }
    return false;
  }
  moveY(w, dy, drop) {
    if (!dy) return false;
    const s = dy > 0 ? 1 : -1;
    let rem = Math.abs(dy);
    while (rem > 0) {
      const st = rem > 8 ? 8 : rem;
      const ny = this.y + s * st;
      if (w.boxSolid(this.x, ny, HW, HH)) {
        if (s > 0) this.y = Math.floor((ny + HH) / TS) * TS - HH - 0.01;
        else this.y = (Math.floor((ny - HH) / TS) + 1) * TS + HH + 0.01;
        return true;
      }
      if (s > 0 && !drop) {
        const top = w.onewayBelow(this.x, this.y + HH, ny + HH, HW);
        if (top >= 0) { this.y = top - HH - 0.01; return true; }
      }
      this.y = ny; rem -= st;
    }
    return false;
  }

  detach() { if (this.hook !== HOOK.NONE) { this.retract = 0.12; this.rx = this.hx; this.ry = this.hy; } this.hook = HOOK.NONE; this.target = -1; }

  update(dt, inp, g) {
    const w = g.world;
    if (this.inv > 0) this.inv -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.retract > 0) this.retract -= dt;
    if (this.land > 0) this.land -= dt;
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) g.respawn(this);
      return;
    }
    this.dashCD -= dt; this.coyote -= dt; this.buffer -= dt; this.wallCoyote -= dt; this.wjLock -= dt;
    if (inp.jumpP) this.buffer = P.buffer;
    const mx = this.wjLock > 0 ? 0 : inp.mx, my = inp.my;

    // ----- 대시 -----
    if (inp.dashP && this.dashCD <= 0 && this.dashes > 0 && this.hook !== HOOK.SNATCH) {
      let dx = inp.mx, dy = inp.my;
      const l = Math.hypot(dx, dy);
      if (l < 0.3) { dx = this.face; dy = 0; } else { dx /= l; dy /= l; }
      this.detach();
      this.dashT = P.dashT; this.dashCD = P.dashCD; this.dashes--;
      this.dashDX = dx; this.dashDY = dy;
      this.vx = dx * P.dashV; this.vy = dy * P.dashV;
      this.inv = Math.max(this.inv, P.dashI);
      if (dx) this.face = sign(dx);
      g.onDash(this);
    }

    // ----- 와이어 발사/해제 -----
    if (inp.hookP && this.hook !== HOOK.SNATCH && this.dashT <= 0) {
      const h = this.hand;
      const aim = g.resolveAim(this, inp);
      let dx = aim.x - h.x, dy = aim.y - h.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      this.hook = HOOK.FLY; this.hx = h.x; this.hy = h.y; this.hvx = dx * P.hookSpd; this.hvy = dy * P.hookSpd; this.hookD = 0;
      if (Math.abs(dx) > 0.2) this.face = sign(dx);
      g.sfx('shoot');
    }
    if (!inp.hookH && (this.hook === HOOK.FLY || this.hook === HOOK.ATTACH)) this.detach();

    if (this.hook === HOOK.FLY) this.flyHook(dt, g);

    // ----- 상태별 이동 -----
    if (this.hook === HOOK.SNATCH) {
      const e = g.getTarget(this.target);
      if (!e || !e.alive) { this.hook = HOOK.NONE; this.vy = Math.min(this.vy, -200); }
      else {
        this.snatchT += dt;
        this.hx = e.x; this.hy = e.y;
        let dx = e.x - this.x, dy = e.y - this.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        this.vx = dx * P.snatchV; this.vy = dy * P.snatchV;
        if (Math.abs(dx) > 0.1) this.face = sign(dx);
        const bx = this.moveX(w, this.vx * dt), by = this.moveY(w, this.vy * dt, true);
        if (bx || by) this.stuck += dt; else this.stuck = 0;
        if (Math.hypot(e.x - this.x, e.y - this.y) < e.r + 14) {
          g.snatchHit(this, e);
          this.hook = HOOK.NONE; this.target = -1;
          this.vx = dx * 260; this.vy = -560;
          this.dashes = 1; this.dashCD = 0;
          this.inv = Math.max(this.inv, 0.35);
          this.retract = 0.1; this.rx = e.x; this.ry = e.y;
        } else if (this.snatchT > P.snatchMax || this.stuck > 0.12) {
          this.detach();
        }
      }
      this.trail.push(this.x, this.y);
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      const bx = this.moveX(w, this.vx * dt), by = this.moveY(w, this.vy * dt, this.vy > 0 && my > 0.5);
      if (bx) this.vx = 0;
      if (by) this.vy = 0;
      g.dashContact(this);
      if (this.dashT <= 0) {
        this.vx *= 0.62;
        this.vy = this.vy < 0 ? this.vy * 0.45 : this.vy * 0.3;
      }
      this.trail.push(this.x, this.y);
    } else {
      this.normalMove(dt, mx, my, inp, g);
    }
    if (this.trail.length > 16) this.trail.splice(0, this.trail.length - 16);
    if (this.dashT <= 0 && this.hook !== HOOK.SNATCH && this.trail.length) this.trail.splice(0, 2);

    // ----- 접지/벽 판정 -----
    const wasGround = this.ground;
    const dropping = my > 0.5 && inp.jumpH;
    this.ground = this.vy >= 0 && (w.boxSolid(this.x, this.y + 1.5, HW, HH) || (!dropping && w.onewayBelow(this.x, this.y + HH - 0.2, this.y + HH + 1.5, HW) >= 0));
    this.wall = 0;
    if (!this.ground) {
      if (w.boxSolid(this.x + 2, this.y, HW, HH - 4)) this.wall = 1;
      else if (w.boxSolid(this.x - 2, this.y, HW, HH - 4)) this.wall = -1;
    }
    if (this.ground) {
      this.coyote = P.coyote; this.dashes = 1;
      if (!wasGround && this.vy >= 0) { this.land = 0.12; g.onLand(this); }
    }
    if (this.wall) { this.wallCoyote = 0.08; this.lastWall = this.wall; this.dashes = 1; }

    if (this.ground && Math.abs(this.vx) > 20) this.anim += Math.abs(this.vx) * dt * 0.045;
    if (this.y > w.ph + 120) g.pitFall(this);
  }

  normalMove(dt, mx, my, inp, g) {
    const w = g.world;
    const hooked = this.hook === HOOK.ATTACH;
    // 수평 가속
    if (this.ground) {
      const tgt = mx * P.runMax;
      if (mx !== 0) {
        if (Math.abs(this.vx) > P.runMax && sign(this.vx) === sign(mx)) this.vx -= sign(this.vx) * Math.min(Math.abs(this.vx) - P.runMax, P.fricG * 0.5 * dt);
        else this.vx += clamp(tgt - this.vx, -P.accG * dt, P.accG * dt);
      } else this.vx -= sign(this.vx) * Math.min(Math.abs(this.vx), P.fricG * dt);
    } else if (hooked) {
      // 스윙: 로프 접선 방향 가속
      const dx = this.x - this.hx, dy = this.y - this.hy, d = Math.hypot(dx, dy) || 1;
      const tx = -dy / d, ty = dx / d;
      if (mx !== 0 && Math.abs(tx) > 0.05) {
        const s = sign(tx) * mx;
        this.vx += tx * s * P.swingAcc * dt; this.vy += ty * s * P.swingAcc * dt;
      }
    } else {
      if (mx !== 0) {
        if (!(Math.abs(this.vx) >= P.runMax && sign(this.vx) === sign(mx))) {
          this.vx += clamp(mx * P.runMax - this.vx, -P.accA * dt, P.accA * dt);
        }
      } else this.vx -= sign(this.vx) * Math.min(Math.abs(this.vx), P.fricA * dt);
      if (Math.abs(this.vx) > P.runMax * 1.02) this.vx -= sign(this.vx) * 140 * dt;
    }
    if (mx !== 0) this.face = sign(mx);

    // 중력
    this.vy += P.grav * dt;
    if (this.wall && this.vy > P.wallSlide && mx === this.wall && !hooked) {
      this.vy = P.wallSlide;
      if (Math.random() < 0.3) g.wallDust(this);
    }

    // 점프
    if (this.buffer > 0) {
      if (hooked) {
        this.detach();
        this.vy = Math.min(this.vy, 0) - 400; this.vx *= 1.15;
        this.dashes = 1; this.buffer = 0; this.jumpCut = false;
        g.onJump(this, 2);
      } else if ((this.ground || this.coyote > 0) && !(my > 0.5 && g.world.onewayBelow(this.x, this.y + 14 - 0.2, this.y + 14 + 1.5, 9) >= 0)) {
        this.vy = -P.jumpV; this.coyote = 0; this.buffer = 0; this.jumpCut = true; this.ground = false;
        g.onJump(this, 0);
      } else if (this.wall || this.wallCoyote > 0) {
        const wd = this.wall || this.lastWall;
        this.vx = -wd * P.wjVx; this.vy = -P.wjVy; this.wjLock = P.wjLock; this.face = -wd;
        this.buffer = 0; this.jumpCut = true; this.wallCoyote = 0;
        g.onJump(this, 1);
      }
    }
    if (this.jumpCut && !inp.jumpH && this.vy < 0) { this.vy *= P.jumpCut; this.jumpCut = false; }
    if (this.vy >= 0) this.jumpCut = false;

    // 릴(당기기/풀기)
    if (hooked) {
      if (my < -0.3) this.ropeLen = Math.max(P.minRope, this.ropeLen - P.reel * dt * -my);
      else if (my > 0.3) this.ropeLen = Math.min(P.hookRange + 40, this.ropeLen + P.reel * 0.8 * dt * my);
    }
    if (this.vy > P.maxFall) this.vy = P.maxFall;

    const drop = my > 0.5 && inp.jumpH;
    if (this.moveX(w, this.vx * dt)) this.vx = 0;
    if (this.moveY(w, this.vy * dt, drop)) {
      if (this.vy > 0 && hooked) { /* 착지 */ }
      this.vy = 0;
    }

    // 로프 제약
    if (this.hook === HOOK.ATTACH) {
      const dx = this.x - this.hx, dy = this.y - this.hy;
      const d = Math.hypot(dx, dy);
      if (d > this.ropeLen && d > 0.001) {
        const nx = dx / d, ny = dy / d;
        const cx = this.hx + nx * this.ropeLen - this.x, cy = this.hy + ny * this.ropeLen - this.y;
        this.moveX(w, cx); this.moveY(w, cy, true);
        const vr = this.vx * nx + this.vy * ny;
        if (vr > 0) { this.vx -= vr * nx; this.vy -= vr * ny; }
      }
      // 당기는 중에는 약간의 추진
      if (my < -0.3) {
        const d2 = Math.hypot(this.x - this.hx, this.y - this.hy) || 1;
        this.vx += (this.hx - this.x) / d2 * 600 * dt; this.vy += (this.hy - this.y) / d2 * 600 * dt;
      }
    }
  }

  flyHook(dt, g) {
    const sub = 4, sdt = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.hx += this.hvx * sdt; this.hy += this.hvy * sdt;
      this.hookD += P.hookSpd * sdt;
      // 적/보스 약점
      const tg = g.hookTargets();
      for (let i = 0; i < tg.length; i++) {
        const e = tg[i];
        if (!e.alive) continue;
        const rr = e.r + 12;
        if ((e.x - this.hx) ** 2 + (e.y - this.hy) ** 2 < rr * rr) {
          if (e.shield) { g.hookDeflect(this, e); this.detach(); return; }
          this.hook = HOOK.SNATCH; this.target = e.id; this.snatchT = 0; this.stuck = 0;
          this.hx = e.x; this.hy = e.y;
          g.onSnatchStart(this, e);
          return;
        }
      }
      // 공중 앵커
      const an = g.anchors;
      for (let i = 0; i < an.length; i++) {
        const a = an[i];
        if ((a.x - this.hx) ** 2 + (a.y - this.hy) ** 2 < 24 * 24) { this.attach(a.x, a.y, g, true); return; }
      }
      const k = g.world.hookTile(this.hx, this.hy);
      if (k === 1) {
        this.attach(this.hx - this.hvx * sdt * 0.1, this.hy - this.hvy * sdt * 0.1, g, false); return;
      } else if (k === 2) { g.hookDeflect(this, { x: this.hx, y: this.hy }); this.detach(); return; }
      if (this.hookD > P.hookRange) { this.detach(); return; }
    }
  }
  attach(x, y, g, anchor) {
    this.hook = HOOK.ATTACH; this.hx = x; this.hy = y;
    this.ropeLen = Math.max(P.minRope, Math.hypot(this.x - x, this.y - y));
    this.dashes = 1;
    g.onAttach(this, anchor);
  }

  // 네트워크 스냅샷
  snap() {
    const f = (this.dashT > 0 ? 1 : 0) | (this.dead ? 2 : 0) | (this.inv > 0 && this.dashT <= 0 && this.hook !== HOOK.SNATCH ? 4 : 0) | (this.ground ? 8 : 0) | (this.wall === 1 ? 16 : this.wall === -1 ? 32 : 0);
    return [Math.round(this.x), Math.round(this.y), Math.round(this.vx), Math.round(this.vy), this.face, this.hook, Math.round(this.hx), Math.round(this.hy), f, this.hp, +this.anim.toFixed(2)];
  }
}

// 원격 플레이어(보간 표시용)
export class RemotePlayer {
  constructor(slot, name, color) {
    this.slot = slot; this.name = name; this.color = color; this.local = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.face = 1; this.hook = 0; this.hx = 0; this.hy = 0;
    this.tx = 0; this.ty = 0; this.thx = 0; this.thy = 0; this.flags = 0; this.hp = P.maxHp; this.anim = 0; this.age = 0;
    this.trail = []; this.scarf = null; this.has = false; this.ground = false; this.wall = 0; this.land = 0; this.retract = 0;
    this.finished = false;
  }
  get dead() { return !!(this.flags & 2); }
  get dashT() { return this.flags & 1 ? 1 : 0; }
  get inv() { return this.flags & 4 ? 1 : 0; }
  get hand() { return { x: this.x + this.face * 5, y: this.y - 3 }; }
  apply(s) {
    const [x, y, vx, vy, face, hook, hx, hy, f, hp, anim] = s;
    if (!this.has || Math.hypot(x - this.x, y - this.y) > 400) { this.x = x; this.y = y; this.hx = hx; this.hy = hy; }
    this.tx = x; this.ty = y; this.vx = vx; this.vy = vy; this.face = face;
    if (this.hook && !hook) { this.retract = 0.12; this.rx = this.hx; this.ry = this.hy; }
    this.hook = hook; this.thx = hx; this.thy = hy; this.flags = f; this.hp = hp; this.anim = anim; this.age = 0; this.has = true;
    this.ground = !!(f & 8); this.wall = f & 16 ? 1 : f & 32 ? -1 : 0;
  }
  tick(dt) {
    this.age += dt;
    if (this.retract > 0) this.retract -= dt;
    const ex = Math.min(this.age, 0.15);
    const px = this.tx + this.vx * ex, py = this.ty + this.vy * ex;
    const k = 1 - Math.exp(-18 * dt);
    this.x += (px - this.x) * k; this.y += (py - this.y) * k;
    if (this.hook === HOOK.FLY) { this.hx += (this.thx - this.hx) * Math.min(1, k * 2); this.hy += (this.thy - this.hy) * Math.min(1, k * 2); } else { this.hx = this.thx; this.hy = this.thy; }
    if (this.flags & 1 || this.hook === HOOK.SNATCH) this.trail.push(this.x, this.y);
    else if (this.trail.length) this.trail.splice(0, 2);
    if (this.trail.length > 16) this.trail.splice(0, this.trail.length - 16);
  }
}
