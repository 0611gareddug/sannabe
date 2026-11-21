// 게임 본체: 루프, 모드(협동/레이스), 네트워크 동기화, HUD
import { TS, T, P, STEP, COLORS } from './config.js';
import { clamp, damp, store, fmtTime, TAU } from './util.js';
import { STAGES, COURSES, getLevel, findStage } from './levels.js';
import { World } from './world.js';
import { Player, RemotePlayer, HOOK } from './player.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Net } from './net.js';

const DEFAULTS = { name: '', color: 0, fx: 2, shake: true, sfx: 0.8, bgm: 0.55, quality: 'auto', fps: false };

export function rankOf(time, par, deaths, dmg) {
  if (time <= par && deaths === 0 && dmg <= 2) return 'S';
  if (time <= par * 1.35 && deaths <= 1) return 'A';
  if (time <= par * 2 && deaths <= 3) return 'B';
  return 'C';
}

export class Game {
  constructor(ui) {
    this.ui = ui;
    this.cv = document.getElementById('cv');
    this.r = new Renderer(this.cv);
    this.input = new Input(this.cv);
    this.snd = new Sound();
    this.fx = new FX();
    this.net = new Net();
    this.settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
    if (!this.settings.name) this.settings.name = 'RUNNER-' + Math.floor(100 + Math.random() * 900);
    this.prog = Object.assign({ ranks: {}, unlocked: 1, best: {} }, store.get('prog', {}));
    this.scene = 'menu';
    this.paused = false;
    this.roster = new Map();
    this.remotes = new Map();
    this.pend = { jumpP: false, hookP: false, dashP: false };
    this.acc = 0; this.last = performance.now();
    this.fpsT = 0; this.fpsN = 0; this.fps = 60; this.slowT = 0;
    this.sendT = 0; this.esT = 0;
    this.menuT = 0;
    this.applySettings();
    this.bindNet();
    window.addEventListener('resize', () => { this.r.resize(); this.r.buildBg(); });
    this.loadMenuBg();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- 설정 ----------
  applySettings() {
    const s = this.settings;
    this.fx.setLevel(s.fx); this.fx.shakeOn = s.shake;
    this.snd.setVol(s.sfx, s.bgm);
    const q = s.quality === 'auto' ? (this.autoQ != null ? this.autoQ : 2) : s.quality;
    if (q !== this.r.quality) this.r.setQuality(q);
  }
  saveSettings() { store.set('settings', this.settings); this.applySettings(); }
  saveProg() { store.set('prog', this.prog); }

  // ---------- 메뉴 배경(데모 화면) ----------
  loadMenuBg() {
    const lv = getLevel(STAGES[1]);
    this.lv = lv; this.world = new World(lv);
    this.r.setLevel(lv, this.world);
    this.r.cam.x = lv.spawn.x + 300; this.r.cam.y = lv.spawn.y - 60;
    this.enemies = null; this.me = null;
  }

  // ---------- 세션 시작 ----------
  start(mode, id) {
    const def = findStage(id);
    if (!def) return;
    this.mode = mode; this.def = def;
    const lv = getLevel(def);
    this.lv = lv; this.world = new World(lv);
    this.r.setLevel(lv, this.world);
    const isHost = !this.net.online || this.net.host;
    this.enemies = mode === 'race' ? new Enemies({ enemies: [] }, isHost) : new Enemies(lv, isHost);
    this.enemies.emit = (t, d) => {
      if (t === 'b') this.snd.play('eshot', 0.8);
      else if (t === 'lz') this.snd.play('laser');
      if (this.net.online && this.net.host) this.net.broadcast({ t, d });
    };
    const prof = this.roster.get(this.net.slot) || { name: this.settings.name, color: this.settings.color };
    this.me = new Player(this.net.online ? this.net.slot : 0, prof.name, COLORS[prof.color] || COLORS[0]);
    for (const [slot, rp] of this.remotes) { rp.has = false; rp.finished = false; }
    this.cpIndex = 0;
    this.healthLeft = lv.health.map((h, i) => ({ ...h, i }));
    this.exitPos = lv.exit;
    this.time = 0; this.done = false; this.exitCount = -1;
    this.stats = { kills: 0, deaths: 0, dmg: 0 };
    this.teamStats = new Map();
    this.boostCD = 0;
    this.countdown = mode === 'race' ? 3.2 : 0;
    this.lastBeep = 4;
    this.raceRes = [];
    this.respawn(this.me, true);
    this.r.cam.x = this.me.x; this.r.cam.y = this.me.y;
    this.fx.count = 0; this.fx.rings.length = 0; this.fx.slow = 0;
    // 레이스 고스트
    this.ghost = null; this.rec = [];
    if (mode === 'race') {
      const g = store.get('ghost_' + def.id, null);
      if (g && g.f && g.f.length) this.ghost = g;
    }
    this.recT = 0;
    this.scene = 'play'; this.paused = false;
    this.input.reset();
    this.snd.music(def.boss ? 'boss' : mode === 'race' ? 'race' : def.tutorial ? 'tut' : 'stage');
    this.ui.onStart(mode, def);
    if (def.boss) this.fx.popText(this.me.x, this.me.y - 60, 'WARNING', '#ff2b55');
  }
  allPlayers() {
    const a = this.me ? [this.me] : [];
    for (const rp of this.remotes.values()) if (rp.has) a.push(rp);
    return a;
  }
  quitToMenu() {
    this.scene = 'menu'; this.paused = false;
    this.loadMenuBg();
    this.snd.music('menu');
  }

  // ---------- 메인 루프 ----------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let rdt = (now - this.last) / 1000; this.last = now;
    if (rdt > 0.05) rdt = 0.05;
    if (rdt <= 0) return;
    this.fpsT += rdt; this.fpsN++;
    if (this.fpsT >= 1) {
      this.fps = this.fpsN / this.fpsT; this.fpsT = 0; this.fpsN = 0;
      this.autoTune();
    }
    this.r.time += rdt;
    if (this.scene === 'play') this.updatePlay(rdt);
    else this.updateMenu(rdt);
    this.draw(rdt);
  }
  autoTune() {
    if (this.settings.quality !== 'auto' || this.scene !== 'play' || document.hidden) { this.slowT = 0; return; }
    if (this.fps < 45) this.slowT++; else this.slowT = 0;
    if (this.slowT >= 3 && this.r.quality > 0) {
      this.autoQ = this.r.quality - 1; this.slowT = 0;
      this.r.setQuality(this.autoQ);
      if (this.fx.level > 1) this.fx.setLevel(this.fx.level - 1);
    }
  }
  updateMenu(rdt) {
    this.menuT += rdt;
    this.r.cam.x += rdt * 60;
    if (this.r.cam.x > this.world.pw - 800) this.r.cam.x = 600;
    this.fx.update(rdt, rdt);
    this.netTick(rdt);
  }
  updatePlay(rdt) {
    const chatting = this.ui.chatOpen;
    this.input.enabled = !chatting && !(this.paused && !this.net.online) && !this.done && this.countdown <= 0;
    const inp = this.input.poll();
    if (inp.jumpP) this.pend.jumpP = true;
    if (inp.hookP) this.pend.hookP = true;
    if (inp.dashP) this.pend.dashP = true;
    if (this.paused && !this.net.online) return;
    const ts = this.fx.timeScale(rdt);
    this.acc += rdt * ts;
    // 자동 조준 미리보기 (프레임당 1회)
    this.aimHi = null; this.aimPreview = null;
    if (this.me && !this.me.dead && inp.auto && this.me.hook === HOOK.NONE) {
      this.aimPreview = this.autoAim(this.me, inp.mx, inp.my);
      if (this.aimPreview && this.aimPreview.kind === 'anchor') this.aimHi = this.aimPreview;
    } else if (this.me && !inp.auto) {
      const w = this.screenToWorld(inp.sx, inp.sy);
      this.mouseWorld = w;
      this.aimAssist = this.assist(this.me, w.x, w.y);
      if (this.aimAssist && this.aimAssist.kind === 'anchor') this.aimHi = this.aimAssist;
    }
    this.lastInp = inp;
    let n = 0;
    while (this.acc >= STEP && n < 10) {
      const si = Object.assign({}, inp, this.pend);
      this.pend.jumpP = this.pend.hookP = this.pend.dashP = false;
      this.step(STEP, si);
      this.acc -= STEP; n++;
    }
    if (n >= 10) this.acc = 0;
    for (const rp of this.remotes.values()) rp.tick(rdt);
    this.fx.update(rdt * ts, rdt);
    this.updateCamera(rdt);
    this.netTick(rdt);
  }
  step(dt, inp) {
    const me = this.me;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this.lastBeep && c >= 1) { this.lastBeep = c; this.snd.play('beep'); }
      if (this.countdown <= 0) { this.snd.play('go'); this.fx.popText(me.x, me.y - 50, 'GO!', '#ffe600'); }
      return;
    }
    if (!this.done) this.time += dt;
    me.update(dt, inp, this);
    this.enemies.update(dt, this);
    if (!me.dead && !this.done) this.checkProps(me, dt);
    if (this.exitCount > 0) {
      this.exitCount -= dt;
      if (this.exitCount <= 0 && (!this.net.online || this.net.host)) this.finishStage();
    }
    if (this.mode === 'race' && !this.done) {
      this.recT += dt;
      if (this.recT >= 1 / 30) {
        this.recT -= 1 / 30;
        this.rec.push(Math.round(me.x), Math.round(me.y), me.hook === HOOK.ATTACH ? Math.round(me.hx) : -1, me.hook === HOOK.ATTACH ? Math.round(me.hy) : -1);
      }
    }
  }
  checkProps(p, dt) {
    const w = this.world, lv = this.lv;
    // 가시
    const x0 = Math.floor((p.x - 7) / TS), x1 = Math.floor((p.x + 7) / TS);
    const y0 = Math.floor((p.y - 12) / TS), y1 = Math.floor((p.y + 13) / TS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = w.at(x, y);
      if (t === T.SPIKE && p.y + 13 > y * TS + TS * 0.45) { if (this.hurt(p, p.x - p.face)) { p.vy = -560; } else if (p.vy > 0 && p.dashT <= 0) p.vy = -420; }
      else if (t === T.SPIKED && p.y - 12 < y * TS + TS * 0.55) { if (this.hurt(p, p.x - p.face)) p.vy = 200; }
    }
    // 체크포인트
    for (let i = this.cpIndex + 1; i < lv.checkpoints.length; i++) {
      const cp = lv.checkpoints[i];
      if (Math.abs(p.x - cp.x) < 26 && Math.abs(p.y - cp.y) < 60) { this.activateCp(i, true); break; }
    }
    // 회복
    for (let i = this.healthLeft.length - 1; i >= 0; i--) {
      const h = this.healthLeft[i];
      if (Math.abs(p.x - h.x) < 24 && Math.abs(p.y - h.y) < 30 && p.hp < P.maxHp) {
        p.hp = Math.min(P.maxHp, p.hp + 2);
        this.healthLeft.splice(i, 1);
        this.snd.play('heal'); this.fx.burst(h.x, h.y, 14, '#39ff14', 200, 0.5);
        this.fx.popText(h.x, h.y - 20, '+HP', '#39ff14');
        if (this.net.online) this.net.send({ t: 'hp', i: h.i });
      }
    }
    // 부스트
    this.boostCD -= dt;
    if (this.boostCD <= 0) for (const b of lv.boosts) {
      if (Math.abs(p.x - b.x) < 22 && Math.abs(p.y + P.h / 2 - b.y) < 8) {
        p.vx = Math.max(p.vx, 780); p.vy = Math.min(p.vy, -120); this.boostCD = 0.4;
        this.snd.play('boost'); this.fx.dir(p.x, p.y + 10, 16, Math.PI, 0.6, '#ffe600', 400, 0.4); this.fx.shake(0.15);
      }
    }
    // 출구
    const ex = this.exitPos;
    if (ex && this.mode !== 'race' && this.exitCount < 0 && Math.abs(p.x - ex.x) < 28 && Math.abs(p.y - ex.y) < 50) {
      if (!this.net.online) this.finishStage();
      else if (this.net.host) this.startExitCount();
      else { this.net.send({ t: 'ex' }); this.exitCount = 99; }
    }
    // 결승선
    if (this.mode === 'race' && lv.finish && p.x >= lv.finish.x - 6 && Math.abs(p.y - lv.finish.y) < 400) this.raceFinish();
  }
  activateCp(i, mine) {
    if (i <= this.cpIndex) return;
    this.cpIndex = i;
    const cp = this.lv.checkpoints[i];
    this.snd.play('cp');
    this.fx.burst(cp.x, cp.y - 30, 20, '#39ff14', 260, 0.6); this.fx.ring(cp.x, cp.y - 30, 80, '#39ff14');
    if (this.me && !this.me.dead) this.me.hp = P.maxHp;
    if (mine && this.net.online) this.net.send({ t: 'cp', i });
  }

  // ---------- 플레이어 이벤트 (Player가 호출) ----------
  sfx(n) { this.snd.play(n); }
  hookTargets() { return this.enemies.list; }
  getTarget(id) { return this.enemies.byId.get(id); }
  get anchors() { return this.lv.anchors; }
  onDash(p) {
    this.snd.play('dash'); this.fx.shake(0.12);
    this.fx.ring(p.x, p.y, 40, p.color, 0.25, 2);
    this.fx.dir(p.x, p.y, 10, Math.atan2(-p.dashDY, -p.dashDX), 0.8, p.color, 260, 0.3);
  }
  onJump(p, k) {
    this.snd.play(k === 1 ? 'wjump' : k === 2 ? 'hjump' : 'jump');
    this.fx.dir(p.x, p.y + 14, 6, k === 1 ? (p.face > 0 ? Math.PI : 0) : Math.PI / 2, 1.6, '#9aa8ff', 120, 0.3);
  }
  onLand(p) { this.snd.play('land', 0.6); this.fx.dir(p.x, p.y + 14, 5, -Math.PI / 2, 2.6, '#9aa8ff', 90, 0.25); }
  wallDust(p) { this.fx.spawn(p.x + p.wall * 9, p.y + 6, -p.wall * 40, -30, 0.3, 1.5, '#9aa8ff', 0, 3, 0); }
  onAttach(p, anchor) {
    this.snd.play(anchor ? 'anchor' : 'attach');
    this.fx.burst(p.hx, p.hy, 6, anchor ? this.r.theme.edge2 : p.color, 160, 0.25);
  }
  onSnatchStart(p, e) { this.snd.play('snatch'); this.fx.ring(e.x, e.y, 30, '#ffe600', 0.2, 2); }
  hookDeflect(p, at) { this.snd.play('deflect'); this.fx.burst(at.x, at.y, 8, '#ff4d8d', 200, 0.3); }
  respawn(p, initial) {
    const cp = this.lv.checkpoints[this.cpIndex] || this.lv.spawn;
    const off = ((p.slot % 4) - 1.5) * 14;
    p.reset(cp.x + (initial || this.net.online ? off : 0), cp.y);
    p.inv = initial ? 0.3 : 1.5;
    if (!initial) { this.fx.ring(p.x, p.y, 60, p.color); this.fx.burst(p.x, p.y, 16, p.color, 220, 0.5); }
  }
  pitFall(p) {
    if (p.dead) return;
    this.stats.dmg++;
    p.hp -= 1;
    this.snd.play('hurt'); this.fx.shake(0.3);
    if (p.hp <= 0) { this.die(p); return; }
    const hp = p.hp; this.respawn(p); p.hp = hp;
  }
  hurt(p, fromX) {
    if (p.dead || p.inv > 0 || p.dashT > 0 || p.hook === HOOK.SNATCH || this.done || this.scene !== 'play') return false;
    p.hp--; this.stats.dmg++;
    p.inv = P.hurtI; p.hurtFlash = 0.2;
    p.detach();
    p.vx = (p.x >= fromX ? 1 : -1) * 320; p.vy = -380;
    this.snd.play('hurt'); this.fx.shake(0.45); this.fx.doFlash(0.25, '#ff2b55');
    this.fx.burst(p.x, p.y, 12, '#ff2b55', 260, 0.4);
    if (p.hp <= 0) this.die(p);
    return true;
  }
  die(p) {
    p.dead = true; p.respawnT = P.respawnT; p.hp = 0; p.detach();
    this.stats.deaths++;
    this.snd.play('die'); this.fx.shake(0.7); this.fx.slowmo(0.25, 0.3);
    this.fx.burst(p.x, p.y, 40, p.color, 420, 0.9); this.fx.ring(p.x, p.y, 90, p.color, 0.5, 4);
  }
  killFx(e, big) {
    const col = e.type === 'pod' ? '#00f0ff' : '#ff2b55';
    this.fx.burst(e.x, e.y, big ? 30 : 20, col, 420, 0.6);
    this.fx.burst(e.x, e.y, 10, '#ffe600', 250, 0.4);
    this.fx.ring(e.x, e.y, 70, '#ffffff', 0.3, 3);
    this.snd.play('kill');
  }
  snatchHit(p, e) {
    this.killFx(e, true);
    this.fx.slowmo(0.16, 0.18); this.fx.shake(0.4); this.fx.doFlash(0.12);
    if (e.type !== 'core') { this.stats.kills++; this.fx.popText(e.x, e.y - 20, 'BREAK', '#ffe600'); }
    this.requestKill(e);
  }
  dashKill(p, e) {
    if (!e.alive) return;
    this.killFx(e, false);
    this.fx.slowmo(0.08, 0.3); this.fx.shake(0.3);
    this.stats.kills++;
    this.requestKill(e);
  }
  dashContact(p) {
    for (const e of this.enemies.list) {
      if (!e.alive || e.type === 'core' || e.type === 'pod') continue;
      const rr = e.r + 12;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr * rr) this.dashKill(p, e);
    }
  }
  requestKill(e) {
    if (!this.net.online || this.net.host) { this.applyKill(e.id, this.net.slot); return; }
    if (e.type !== 'core' && e.type !== 'pod') this.enemies.kill(e.id);
    this.net.send({ t: 'hit', id: e.id });
  }
  applyKill(id, by) {
    const en = this.enemies;
    if (id >= 999 && id < 1003) {
      const r = en.bossHit(id);
      if (r) { if (this.net.online) this.net.broadcast({ t: 'bh', id, r }); this.bossFx(r, id); }
      return;
    }
    const e = en.kill(id);
    if (e && this.net.online) this.net.broadcast({ t: 'ek', id, by });
    if (e && by !== this.net.slot) this.killFx(e, false);
  }
  bossFx(r, id) {
    const b = this.enemies.boss;
    if (!b) return;
    if (r === 'pod') { this.fx.popText(b.x, b.y - 80, 'POD DOWN', '#00f0ff'); }
    else if (r === 'stun') { this.snd.play('shield'); this.fx.ring(b.x, b.y, 200, '#ffe600', 0.6, 5); this.fx.popText(b.x, b.y - 90, 'CORE EXPOSED', '#ffe600'); this.fx.shake(0.5); }
    else if (r === 'core' || r === 'phase') {
      this.snd.play('bosshit'); this.fx.slowmo(0.3, 0.15); this.fx.shake(0.8); this.fx.doFlash(0.4, '#ffe600');
      this.fx.burst(b.x, b.y, 40, '#ffe600', 500, 0.8);
      if (r === 'phase') { this.fx.popText(b.x, b.y - 90, 'PHASE ' + b.phase, '#ff2b55'); this.enemies.bullets.length = 0; }
    } else if (r === 'dead') this.bossDead();
  }
  bossDead() {
    const b = this.enemies.boss;
    b.dead = true;
    this.enemies.placePods();
    this.snd.play('boom'); this.fx.slowmo(1.2, 0.2); this.fx.shake(1); this.fx.doFlash(0.9);
    for (let i = 0; i < 4; i++) this.fx.ring(b.x, b.y, 120 + i * 80, i % 2 ? '#ffe600' : '#ff2b55', 0.6 + i * 0.2, 6);
    this.fx.burst(b.x, b.y, 120, '#ff2b55', 700, 1.4); this.fx.burst(b.x, b.y, 60, '#ffe600', 500, 1.2);
    this.enemies.bullets.length = 0; this.enemies.lasers.length = 0;
    for (const e of this.enemies.list) if (e.type === 'drone' && e.alive) { e.alive = false; this.fx.burst(e.x, e.y, 14, '#ff2b55', 300, 0.5); }
    this.exitPos = this.lv.exitLater;
    this.snd.music('stage');
  }
  bossEvent(k) {
    if (this.net.online && this.net.host && k === 'attack') return;
    if (k === 'regen') { this.snd.play('shield'); const b = this.enemies.boss; this.fx.ring(b.x, b.y, 160, '#00f0ff', 0.5, 3); }
  }

  // ---------- 조준 ----------
  screenToWorld(sx, sy) {
    const cam = this.r.cam, d = this.r.dpr;
    return { x: (sx * d - this.r.w / 2) / cam.s + cam.x, y: (sy * d - this.r.h / 2) / cam.s + cam.y };
  }
  assist(p, wx, wy) {
    const h = p.hand;
    let best = null, bd = 50 * 50;
    for (const e of this.enemies.list) {
      if (!e.alive || e.shield) continue;
      const d = (e.x - wx) ** 2 + (e.y - wy) ** 2;
      if (d < bd && Math.hypot(e.x - h.x, e.y - h.y) < P.hookRange + e.r && this.world.los(h.x, h.y, e.x, e.y)) { bd = d; best = { x: e.x, y: e.y, kind: 'enemy' }; }
    }
    if (!best) for (const a of this.lv.anchors) {
      const d = (a.x - wx) ** 2 + (a.y - wy) ** 2;
      if (d < bd && Math.hypot(a.x - h.x, a.y - h.y) < P.hookRange && this.world.los(h.x, h.y, a.x, a.y)) { bd = d; best = { x: a.x, y: a.y, kind: 'anchor' }; }
    }
    return best;
  }
  resolveAim(p, inp) {
    if (!inp.auto) {
      const w = this.screenToWorld(inp.sx, inp.sy);
      return this.assist(p, w.x, w.y) || w;
    }
    const a = this.autoAim(p, inp.mx, inp.my);
    if (a) return a;
    const h = p.hand;
    return { x: h.x + p.face * 0.6 * 100, y: h.y - 80 };
  }
  autoAim(p, mx, my) {
    const h = p.hand, R = P.hookRange, w = this.world;
    let dx, dy;
    const pa = this.input.padAim;
    if (pa) { dx = pa.x; dy = pa.y; }
    else {
      dx = mx !== 0 ? mx : p.face * 0.8;
      dy = my < -0.3 ? -1.5 : my > 0.3 ? 0.7 : -0.95;
    }
    const base = Math.atan2(dy, dx);
    const angD = (a) => { let d = a - base; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return Math.abs(d); };
    let best = null, bs = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.shield) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d > R + e.r || d < 20) continue;
      const ad = angD(Math.atan2(e.y - h.y, e.x - h.x));
      if (ad > 1.7 && d > 140) continue;
      if (!w.los(h.x, h.y, e.x, e.y)) continue;
      const s = d / R * 0.6 + ad * 0.45 - 0.55;
      if (s < bs) { bs = s; best = { x: e.x, y: e.y, kind: 'enemy' }; }
    }
    for (const a of this.lv.anchors) {
      const d = Math.hypot(a.x - h.x, a.y - h.y);
      if (d > R - 4 || d < 30) continue;
      const ad = angD(Math.atan2(a.y - h.y, a.x - h.x));
      if (ad > 1.4) continue;
      if (!w.los(h.x, h.y, a.x, a.y)) continue;
      const s = d / R * 0.4 + ad * 0.8 - 0.15;
      if (s < bs) { bs = s; best = { x: a.x, y: a.y, kind: 'anchor' }; }
    }
    for (let k = -5; k <= 5; k++) {
      const a = base + k * 0.18;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hit = w.ray(h.x, h.y, ca, sa, R - 6);
      if (!hit || hit.kind !== 1 || hit.d < 50) continue;
      const s = Math.abs(k) * 0.18 * 0.9 + Math.abs(hit.d - 230) / 500 + 0.25;
      if (s < bs) { bs = s; best = { x: hit.x, y: hit.y, kind: 'wall' }; }
    }
    return best;
  }

  // ---------- 카메라 ----------
  updateCamera(rdt) {
    const cam = this.r.cam, me = this.me;
    if (!me) return;
    const vw = this.r.w / cam.s, vh = this.r.h / cam.s;
    let tx = me.x + clamp(me.vx * 0.22, -170, 170), ty = me.y - 30 + clamp(me.vy * 0.1, -80, 110);
    if (this.enemies.boss && !this.enemies.boss.dead) { tx = (tx * 2 + this.enemies.boss.x) / 3; ty = (ty * 2 + this.enemies.boss.y) / 3; }
    cam.x = damp(cam.x, tx, 6, rdt); cam.y = damp(cam.y, ty, 5, rdt);
    if (me.dead) { cam.x = damp(cam.x, me.x, 2, rdt); }
    const pw = this.world.pw, ph = this.world.ph;
    cam.x = pw < vw ? pw / 2 : clamp(cam.x, vw / 2, pw - vw / 2);
    cam.y = ph < vh ? ph / 2 : clamp(cam.y, vh / 2 - 64, ph - vh / 2 + 40);
  }

  // ---------- 스테이지 종료 ----------
  startExitCount() {
    if (this.exitCount > 0 && this.exitCount < 99) return;
    this.exitCount = 3;
    this.net.broadcast({ t: 'exc' });
    this.snd.play('cp');
  }
  finishStage() {
    if (this.done) return;
    this.done = true; this.exitCount = -1;
    if (this.net.online && this.net.host) this.net.broadcast({ t: 'clr', time: this.time });
    this.showClear(this.time);
  }
  showClear(time) {
    this.done = true; this.exitCount = -1; this.time = time;
    this.snd.play('clear'); this.fx.slowmo(0.4, 0.3);
    const def = this.def;
    const rank = rankOf(time, def.par, this.stats.deaths, this.stats.dmg);
    const idx = STAGES.findIndex((s) => s.id === def.id);
    const order = 'CBAS';
    const prev = this.prog.ranks[def.id];
    const newBest = !prev || order.indexOf(rank) > order.indexOf(prev);
    if (newBest) this.prog.ranks[def.id] = rank;
    const pb = this.prog.best[def.id];
    if (!pb || time < pb) this.prog.best[def.id] = time;
    if (idx >= 0 && this.prog.unlocked < idx + 2) this.prog.unlocked = Math.min(STAGES.length, idx + 2);
    this.saveProg();
    const my = { slot: this.net.slot, name: this.me.name, color: this.me.color, ...this.stats };
    this.teamStats.set(this.net.slot, my);
    if (this.net.online) this.net.send({ t: 'st', s: my });
    setTimeout(() => this.ui.showResult({ rank, time, par: def.par, stats: this.stats, def, next: STAGES[idx + 1], newBest, team: this.teamStats }), 700);
  }
  raceFinish() {
    if (this.done) return;
    this.done = true;
    const t = this.time, def = this.def;
    this.snd.play('clear'); this.fx.slowmo(0.5, 0.25); this.fx.doFlash(0.3, '#ffe600');
    const pb = this.prog.best[def.id];
    const isBest = !pb || t < pb;
    if (isBest) {
      this.prog.best[def.id] = t; this.saveProg();
      store.set('ghost_' + def.id, { t, f: this.rec });
    }
    if (this.net.online) {
      if (this.net.host) this.raceRecord(this.net.slot, t); else this.net.send({ t: 'fin', time: t });
    }
    setTimeout(() => this.ui.showRace({ time: t, best: isBest ? t : pb, isBest, ghost: this.ghost ? this.ghost.t : null, def, standings: this.raceRes }), 900);
  }
  raceRecord(slot, t) {
    if (this.raceRes.some((r) => r.slot === slot)) return;
    const prof = this.roster.get(slot) || { name: '?', color: 0 };
    this.raceRes.push({ slot, name: prof.name, color: prof.color, time: t });
    this.raceRes.sort((a, b) => a.time - b.time);
    this.net.broadcast({ t: 'rr', l: this.raceRes });
    this.ui.updateRace(this.raceRes);
  }

  // ---------- 네트워크 ----------
  bindNet() {
    const net = this.net;
    net.acceptJoin = () => (this.scene === 'play' ? '게임이 이미 진행 중이에요. 잠시 후 다시 시도해 주세요.' : true);
    net.onJoin = (slot, meta) => {
      this.roster.set(slot, { name: String(meta.name || 'RUNNER').slice(0, 12), color: clamp(meta.color | 0, 0, COLORS.length - 1) });
      net.sendTo(slot, { t: 'welcome', slot });
      this.pushLobby();
      this.ui.chatSys(this.roster.get(slot).name + ' 님이 들어왔어요.');
      this.snd.play('ui');
    };
    net.onLeave = (slot) => {
      const p = this.roster.get(slot);
      this.roster.delete(slot); this.remotes.delete(slot);
      net.broadcast({ t: 'leave', i: slot });
      this.pushLobby();
      if (p) this.ui.chatSys(p.name + ' 님이 나갔어요.');
    };
    net.onClose = (msg) => {
      this.leaveOnline();
      this.ui.toast(msg);
      this.ui.goMenu();
      this.quitToMenu();
    };
    net.onMsg = (m, from) => this.onMsg(m, from);
  }
  pushLobby() {
    const players = [...this.roster.entries()].map(([i, p]) => ({ i, name: p.name, color: p.color })).sort((a, b) => a.i - b.i);
    const msg = { t: 'lobby', players, sel: this.lobbySel };
    this.net.broadcast(msg);
    this.ui.renderLobby(msg);
  }
  async host() {
    const code = await this.net.createRoom();
    this.roster.clear(); this.remotes.clear();
    this.roster.set(0, { name: this.settings.name, color: this.settings.color });
    this.lobbySel = { mode: 'coop', id: 'tut' };
    this.pushLobby();
    return code;
  }
  async join(code) {
    const w = await this.net.joinRoom(code, { name: this.settings.name, color: this.settings.color });
    this.roster.clear(); this.remotes.clear();
    return w;
  }
  leaveOnline() {
    this.net.close();
    this.roster.clear(); this.remotes.clear();
  }
  setLobbySel(sel) { this.lobbySel = sel; this.pushLobby(); }
  hostStart() {
    const s = this.lobbySel;
    this.net.broadcast({ t: 'start', mode: s.mode, id: s.id });
    this.startOnline(s.mode, s.id);
  }
  startOnline(mode, id) {
    for (const [slot, p] of this.roster) if (slot !== this.net.slot && !this.remotes.has(slot)) this.remotes.set(slot, new RemotePlayer(slot, p.name, COLORS[p.color]));
    for (const slot of [...this.remotes.keys()]) if (!this.roster.has(slot)) this.remotes.delete(slot);
    this.start(mode, id);
  }
  backToLobby() {
    if (this.net.host) this.net.broadcast({ t: 'lobbyBack' });
    this.scene = 'menu'; this.quitToMenu();
    this.ui.showLobby();
  }
  sendChat(text) {
    text = String(text).trim().slice(0, 80);
    if (!text) return;
    const slot = this.net.slot;
    const p = this.roster.get(slot);
    this.ui.chatLine(p ? p.name : this.settings.name, COLORS[p ? p.color : this.settings.color], text);
    this.net.send({ t: 'chat', i: slot, m: text });
  }
  onMsg(m, from) {
    const net = this.net, host = net.host;
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'ps': {
        const i = host ? from : m.i;
        if (i === net.slot) return;
        let rp = this.remotes.get(i);
        if (!rp) {
          const prof = this.roster.get(i); if (!prof) return;
          rp = new RemotePlayer(i, prof.name, COLORS[prof.color]); this.remotes.set(i, rp);
        }
        if (Array.isArray(m.s)) rp.apply(m.s);
        if (host) net.broadcast({ t: 'ps', i, s: m.s }, from);
        break;
      }
      case 'chat': {
        const i = host ? from : m.i;
        const p = this.roster.get(i);
        const text = String(m.m || '').slice(0, 80);
        if (p) { this.ui.chatLine(p.name, COLORS[p.color], text); this.snd.play('chat'); }
        if (host) net.broadcast({ t: 'chat', i, m: text }, from);
        break;
      }
      case 'prof':
        if (host) { const p = this.roster.get(from); if (p) { p.name = String(m.name).slice(0, 12); p.color = clamp(m.color | 0, 0, 7); this.pushLobby(); } }
        break;
      case 'lobby':
        if (host) return;
        this.roster.clear();
        for (const p of m.players) this.roster.set(p.i, { name: p.name, color: p.color });
        for (const slot of [...this.remotes.keys()]) if (!this.roster.has(slot)) this.remotes.delete(slot);
        this.lobbySel = m.sel;
        this.ui.renderLobby(m);
        break;
      case 'start': if (!host) this.startOnline(m.mode, m.id); break;
      case 'lobbyBack': if (!host) { this.scene = 'menu'; this.quitToMenu(); this.ui.showLobby(); } break;
      case 'leave': this.remotes.delete(m.i); break;
      case 'es': if (!host && this.scene === 'play' && this.enemies) this.enemies.applySnapshot(m.d); break;
      case 'b': if (!host && this.scene === 'play' && this.enemies) { for (const b of m.d) this.enemies.spawnBullet(b); this.snd.play('eshot'); } break;
      case 'lz': if (!host && this.scene === 'play' && this.enemies) { this.enemies.addLaser(m.d); this.snd.play('laser'); } break;
      case 'bev': if (!host && this.scene === 'play') this.bossEvent(m.d.k); break;
      case 'hit': if (host && this.scene === 'play') this.applyKill(m.id | 0, from); break;
      case 'ek': if (!host && this.scene === 'play') { const e = this.enemies.kill(m.id); if (e) this.killFx(e, false); } break;
      case 'bh': if (!host && this.scene === 'play') { if (m.r === 'dead') this.enemies.boss.dead = true; this.bossFx(m.r, m.id); } break;
      case 'cp':
        if (this.scene !== 'play') return;
        this.activateCp(m.i | 0, false);
        if (host) net.broadcast({ t: 'cp', i: m.i }, from);
        break;
      case 'hp': {
        if (this.scene !== 'play') return;
        const k = this.healthLeft.findIndex((h) => h.i === m.i);
        if (k >= 0) this.healthLeft.splice(k, 1);
        if (host) net.broadcast({ t: 'hp', i: m.i }, from);
        break;
      }
      case 'ex': if (host && this.scene === 'play') this.startExitCount(); break;
      case 'exc': if (!host) { this.exitCount = 3; this.snd.play('cp'); } break;
      case 'clr': if (!host && this.scene === 'play') this.showClear(m.time); break;
      case 'st': {
        const s = m.s; if (!s) return;
        const slot = host ? from : s.slot;
        const prof = this.roster.get(slot);
        this.teamStats.set(slot, { slot, name: prof ? prof.name : s.name, color: prof ? COLORS[prof.color] : s.color, kills: s.kills | 0, deaths: s.deaths | 0, dmg: s.dmg | 0 });
        if (host) net.broadcast({ t: 'st', s: { ...s, slot } }, from);
        this.ui.updateTeam(this.teamStats);
        break;
      }
      case 'fin': if (host) this.raceRecord(from, +m.time); break;
      case 'rr': if (!host) { this.raceRes = m.l; this.ui.updateRace(m.l); } break;
      default: break;
    }
  }
  netTick(rdt) {
    const net = this.net;
    if (!net.online || this.scene !== 'play' || !this.me) return;
    this.sendT -= rdt;
    if (this.sendT <= 0) {
      this.sendT = 0.05;
      const s = this.me.snap();
      if (net.host) net.broadcast({ t: 'ps', i: 0, s }); else net.send({ t: 'ps', s });
    }
    if (net.host && this.mode !== 'race') {
      this.esT -= rdt;
      if (this.esT <= 0) { this.esT = 1 / 15; net.broadcast({ t: 'es', d: this.enemies.snapshot(this.allPlayers()) }); }
    }
  }

  // ---------- 튜토리얼 힌트 문구 ----------
  hintText(k) {
    const m = this.input.mode;
    const K = m === 'touch'
      ? { move: '◀ ▶ 조이스틱', jump: '점프 버튼', wall: '벽에 붙어 점프', hook: '와이어 버튼 (누르고 있기)', reel: '와이어 중 조이스틱 ▲', dash: '대시 버튼', snatch: '적에게 와이어', swing: '와이어 + ◀ ▶ 흔들기', exit: '포털로 이동' }
      : m === 'pad'
        ? { move: 'L-STICK', jump: 'A', wall: '벽 + A', hook: 'RT / RB (홀드)', reel: '와이어 중 ▲', dash: 'X / LB', snatch: '적에게 RT', swing: 'RT + ◀ ▶', exit: 'EXIT' }
        : { move: 'A  D', jump: 'SPACE', wall: '벽 + SPACE', hook: '마우스 좌클릭 (홀드)', reel: '와이어 중 W', dash: 'SHIFT / 우클릭', snatch: '적을 클릭', swing: '클릭 유지 + A D', exit: 'EXIT' };
    const L = { move: '이동', jump: '점프', wall: '벽 점프로 오르기', hook: '천장에 와이어 걸기', reel: '당겨서 올라가기', dash: '대시 (무적 시간)', snatch: '낚아채기 돌진', swing: '앵커를 이어 스윙', exit: '포털에 들어가면 클리어' };
    return { key: K[k], label: L[k] };
  }

  // ---------- 그리기 ----------
  draw(rdt) {
    const r = this.r, c = r.ctx, fx = this.fx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    r.drawBg(rdt);
    r.beginWorld(fx.shakeX, fx.shakeY);
    r.drawTiles();
    if (this.scene === 'play') {
      r.drawProps(this);
      if (this.enemies) r.drawEnemies(this.enemies);
      if (this.ghost && !this.done) this.drawGhost();
      for (const rp of this.remotes.values()) if (rp.has) { r.drawPlayer(rp, rdt, this.mode === 'race'); if (!rp.dead) r.nameTag(rp); }
      if (this.me) r.drawPlayer(this.me, rdt);
      if (this.enemies) r.drawShots(this.enemies);
      fx.draw(c);
      this.drawAim();
    } else {
      fx.draw(c);
    }
    r.endWorld();
    if (fx.flash > 0) { c.globalAlpha = Math.min(0.6, fx.flash); c.fillStyle = fx.flashCol; c.fillRect(0, 0, r.w, r.h); c.globalAlpha = 1; }
    if (fx.slow > 0 && this.scene === 'play') {
      const g = c.createRadialGradient(r.w / 2, r.h / 2, r.h * 0.3, r.w / 2, r.h / 2, r.h * 0.9);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(40,0,60,0.45)');
      c.fillStyle = g; c.fillRect(0, 0, r.w, r.h);
    }
    if (this.scene === 'play') this.drawHUD();
    else if (this.settings.fps) this.drawFps();
  }
  drawGhost() {
    const g = this.ghost, i = Math.floor(this.time * 30) * 4;
    if (i + 3 >= g.f.length) return;
    const f = g.f;
    this.r.drawGhost({ x: f[i], y: f[i + 1], hx: f[i + 2] >= 0 ? f[i + 2] : null, hy: f[i + 3] });
  }
  drawAim() {
    const me = this.me;
    if (!me || me.dead || this.done) return;
    const col = me.color;
    if (this.lastInp && this.lastInp.auto) {
      const a = this.aimPreview;
      if (a && me.hook === HOOK.NONE) this.r.drawReticle(a.x, a.y, a.kind === 'enemy' ? '#ffe600' : col, a.kind !== 'wall');
    } else if (this.mouseWorld && this.input.mouse.moved) {
      const a = this.aimAssist;
      if (a) this.r.drawReticle(a.x, a.y, a.kind === 'enemy' ? '#ffe600' : col, true);
      const h = me.hand, w = this.mouseWorld;
      const d = Math.hypot(w.x - h.x, w.y - h.y);
      const c = this.r.ctx;
      c.strokeStyle = col; c.globalAlpha = 0.15; c.lineWidth = 1;
      const k = Math.min(1, P.hookRange / (d || 1));
      c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(h.x + (w.x - h.x) * k, h.y + (w.y - h.y) * k); c.stroke();
      c.globalAlpha = 1;
      this.r.drawReticle(w.x, w.y, d > P.hookRange ? '#ff4d8d' : '#ffffff', false);
    }
  }
  drawFps() {
    const c = this.r.ctx, u = this.r.uiScale * this.r.dpr;
    c.font = `600 ${11 * u}px Orbitron, sans-serif`; c.textAlign = 'left'; c.fillStyle = '#7dffcf';
    c.fillText(Math.round(this.fps) + ' FPS', 12 * u, this.r.h - 12 * u);
  }
  drawHUD() {
    const r = this.r, c = r.ctx, u = r.uiScale * r.dpr, me = this.me, W = r.w, H = r.h;
    const touch = this.input.mode === 'touch';
    c.textBaseline = 'alphabetic';
    // 체력
    const hx = 18 * u, hy = 18 * u;
    for (let i = 0; i < P.maxHp; i++) {
      const x = hx + i * 26 * u;
      c.beginPath(); c.moveTo(x + 5 * u, hy); c.lineTo(x + 24 * u, hy); c.lineTo(x + 19 * u, hy + 12 * u); c.lineTo(x, hy + 12 * u); c.closePath();
      if (i < me.hp) { c.fillStyle = me.color; c.fill(); } else { c.fillStyle = 'rgba(10,8,30,0.6)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 1 * u; c.stroke(); }
    }
    // 대시
    const dready = me.dashes > 0 && me.dashCD <= 0;
    c.fillStyle = dready ? '#ffffff' : 'rgba(255,255,255,0.2)';
    c.fillRect(hx, hy + 18 * u, 40 * u, 4 * u);
    c.font = `700 ${9 * u}px Orbitron, sans-serif`; c.textAlign = 'left';
    c.fillText('DASH', hx + 46 * u, hy + 23 * u);
    // 스테이지 이름 / 처치 수
    c.fillStyle = 'rgba(232,244,255,0.75)';
    c.font = `700 ${10 * u}px Orbitron, sans-serif`;
    c.fillText(this.def.code + (this.mode === 'race' ? '' : '  ·  KO ' + this.stats.kills), hx, hy + 42 * u);
    // 타이머
    c.textAlign = 'center';
    c.font = `800 ${22 * u}px Orbitron, sans-serif`;
    c.fillStyle = '#ffffff';
    c.fillText(fmtTime(this.time), W / 2, 34 * u);
    if (this.mode === 'race' && this.ghost && !this.done) {
      c.font = `600 ${11 * u}px Orbitron, sans-serif`; c.fillStyle = 'rgba(232,244,255,0.6)';
      c.fillText('BEST ' + fmtTime(this.ghost.t), W / 2, 52 * u);
    }
    // 보스 체력
    const b = this.enemies.boss;
    if (b && !b.dead) {
      const bw = Math.min(W * 0.5, 520 * u), bx = W / 2 - bw / 2, by = 50 * u;
      c.font = `700 ${10 * u}px Orbitron, sans-serif`; c.fillStyle = '#ff2b55';
      c.fillText('OVERWATCH CORE', W / 2, by + 2 * u);
      const seg = bw / b.max;
      for (let i = 0; i < b.max; i++) {
        c.fillStyle = i < b.hp ? (b.stun > 0 ? '#ffe600' : '#ff2b55') : 'rgba(255,255,255,0.12)';
        c.fillRect(bx + i * seg + 1 * u, by + 8 * u, seg - 2 * u, 7 * u);
      }
    }
    // 카운트다운
    if (this.countdown > 0) {
      const n = Math.ceil(this.countdown);
      const k = this.countdown % 1;
      c.font = `900 ${90 * u * (0.8 + k * 0.4)}px Orbitron, sans-serif`;
      c.globalAlpha = 0.4 + k * 0.6; c.fillStyle = '#ffe600';
      c.fillText(n > 3 ? 3 : n, W / 2, H / 2);
      c.globalAlpha = 1;
    }
    if (this.exitCount > 0 && this.exitCount < 50 && !this.done) {
      c.font = `800 ${18 * u}px "Noto Sans KR", sans-serif`; c.fillStyle = '#7dffcf';
      c.fillText('탈출까지 ' + Math.ceil(this.exitCount), W / 2, H * 0.22);
    } else if (this.exitCount >= 50 && !this.done) {
      c.font = `700 ${14 * u}px "Noto Sans KR", sans-serif`; c.fillStyle = '#7dffcf';
      c.fillText('탈출 신호 전송 중...', W / 2, H * 0.22);
    }
    if (me.dead) {
      c.font = `800 ${20 * u}px "Noto Sans KR", sans-serif`; c.fillStyle = '#ff2b55';
      c.fillText('재접속 중...', W / 2, H * 0.45);
    }
    // 화면 밖 동료 표시
    const cam = r.cam;
    for (const rp of this.remotes.values()) {
      if (!rp.has || rp.dead) continue;
      const sx = (rp.x - cam.x) * cam.s + W / 2, sy = (rp.y - cam.y) * cam.s + H / 2;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const m = 30 * u;
      const ax = clamp(sx, m, W - m), ay = clamp(sy, m + 40 * u, H - m);
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      c.save(); c.translate(ax, ay); c.rotate(a);
      c.fillStyle = rp.color;
      c.beginPath(); c.moveTo(12 * u, 0); c.lineTo(-6 * u, -8 * u); c.lineTo(-6 * u, 8 * u); c.closePath(); c.fill();
      c.restore();
    }
    // 온라인 인원
    if (this.net.online) {
      c.textAlign = 'right'; c.font = `600 ${10 * u}px "Noto Sans KR", sans-serif`;
      let y = 66 * r.dpr + 12 * u;
      for (const p of this.allPlayers()) {
        c.fillStyle = p.color;
        c.fillText((p.dead ? '✕ ' : '') + p.name + (this.mode !== 'race' ? '  ♥' + p.hp : ''), W - 16 * u, y);
        y += 15 * u;
      }
    }
    if (this.settings.fps) this.drawFps();
  }
}
