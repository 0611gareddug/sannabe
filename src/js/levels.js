// 레벨 생성: 손으로 설계한 '구간 템플릿'을 이어 붙여 스테이지를 만든다.
// 모든 구간은 와이어 사거리 안에 걸 곳이 있도록 설계되어 항상 통과 가능하다.
import { TS, T, P } from './config.js';
import { rng } from './util.js';

class Composer {
  constructor(seed) {
    this.r = rng(seed);
    this.cols = []; // {f: floorRow|null|'wall', c: ceilRow|null}
    this.ops = [];
    this.ents = { enemies: [], anchors: [], checkpoints: [], health: [], boosts: [], hints: [], spawn: null, exit: null, finish: null };
    this.gy = 0; // 현재 바닥 행(상대값)
    this.rh = 9; // 천장까지 높이
  }
  get x() { return this.cols.length; }
  ri(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  col(f, c) { this.cols.push({ f, c }); }
  rect(x, y, w, h, v = T.SOLID) { this.ops.push([x, y, w, h, v]); }
  ent(kind, x, y, extra) {
    const o = Object.assign({ x, y }, extra || {});
    if (kind === 'spawn' || kind === 'exit' || kind === 'finish') this.ents[kind] = o;
    else this.ents[kind].push(o);
  }
  enemy(type, x, y) { this.ents.enemies.push({ type, x, y }); }
  hint(k, x0) { this.ent('hints', x0 + 2, this.gy - this.rh + 2, { k }); }

  // ---------- 구간 템플릿 ----------
  start() {
    this.col('wall'); this.col('wall');
    const x0 = this.x;
    for (let i = 0; i < 7; i++) this.col(this.gy, this.gy - this.rh);
    this.ent('spawn', x0 + 2, this.gy - 1);
    this.ent('checkpoints', x0 + 2, this.gy - 1, { start: true });
  }
  run(n, o = {}) {
    const x0 = this.x, gy = this.gy;
    for (let i = 0; i < n; i++) this.col(gy, gy - this.rh);
    if (o.blocks) for (const [off, w, h] of o.blocks) this.rect(x0 + off, gy - h, w, h);
    if (o.bump) {
      const bx = x0 + this.ri(3, Math.max(3, n - 5));
      this.rect(bx, gy - this.ri(1, 2), this.ri(2, 3), 2);
    }
    this.spread(x0, n, o);
    if (o.boost) for (let k = 0; k < o.boost; k++) this.ent('boosts', x0 + 2 + Math.floor((n - 4) * (k + 0.5) / o.boost), gy - 1);
    if (o.hint) this.hint(o.hint, x0);
  }
  spread(x0, n, o) {
    const gy = this.gy;
    if (o.e) for (let k = 0; k < o.e; k++) this.enemy('walker', x0 + Math.floor(n * (k + 1) / (o.e + 1)), gy - 1);
    if (o.d) for (let k = 0; k < o.d; k++) this.enemy('drone', x0 + Math.floor(n * (k + 1) / (o.d + 1)), gy - Math.floor(this.rh / 2) - (k % 2));
    if (o.t) for (let k = 0; k < o.t; k++) this.enemy('turret', x0 + Math.floor(n * (k + 1) / (o.t + 1)) + 1, gy - this.rh + 1);
    if (o.h) this.ent('health', x0 + Math.floor(n / 2), gy - 2);
  }
  pit(n, o = {}) {
    const x0 = this.x, gy = this.gy, c = gy - this.rh;
    for (let i = 0; i < n; i++) this.col(o.spk ? gy + 3 : null, c);
    if (o.spk) this.rect(x0, gy + 2, n, 1, T.SPIKE);
    // 천장에서 내려온 기둥(걸 곳)
    for (let px = x0 + 3; px < x0 + n - 2; px += this.ri(5, 7)) this.rect(px, c + 1, 2, this.ri(1, 3));
    if (o.d) for (let k = 0; k < o.d; k++) this.enemy('drone', x0 + Math.floor(n * (k + 1) / (o.d + 1)), gy - 3);
    if (o.hint) this.hint(o.hint, x0);
  }
  pitGlass(n, o = {}) {
    // 유리 천장(와이어 불가) + 공중 앵커만으로 건너야 하는 구간
    const x0 = this.x, gy = this.gy, c = gy - this.rh;
    for (let i = 0; i < n; i++) this.col(null, c);
    this.rect(x0, c, n, 1, T.GLASS);
    for (let px = x0 + 3; px < x0 + n - 1; px += 5) this.ent('anchors', px, gy - this.rh + 3 + ((px >> 1) % 2));
    if (o.d) for (let k = 0; k < o.d; k++) this.enemy('drone', x0 + Math.floor(n * (k + 1) / (o.d + 1)) + 2, gy - 2);
    if (o.hint) this.hint(o.hint, x0);
  }
  sky(n, o = {}) {
    const x0 = this.x, gy = this.gy;
    for (let i = 0; i < n; i++) this.col(null, null);
    let px = x0 + 2;
    while (px < x0 + n - 1) {
      this.ent('anchors', px, gy - this.rh + 2 + this.ri(0, 2));
      px += this.ri(5, 6);
    }
    if (o.d) for (let k = 0; k < o.d; k++) this.enemy('drone', x0 + Math.floor(n * (k + 1) / (o.d + 1)) + 2, gy - 1);
    if (o.hint) this.hint(o.hint, x0);
  }
  up(h, o = {}) {
    // 아래쪽 천장은 와이어 사거리 안(h+3칸)으로 낮춰 당기기로 오를 수 있게 한다
    const x0 = this.x, gy = this.gy, c = gy - h - this.rh;
    for (let i = 0; i < 4; i++) this.col(gy, Math.max(c, gy - h - 3));
    for (let i = 0; i < 5; i++) this.col(gy - h, c);
    if (h >= 5) this.rect(x0, gy - Math.ceil(h / 2) - 1, 2, 1, T.ONEWAY);
    if (o.hint) this.hint(o.hint, x0);
    this.gy -= h;
  }
  down(h, o = {}) {
    const gy = this.gy, c = gy - this.rh;
    for (let i = 0; i < 3; i++) this.col(gy, c);
    for (let i = 0; i < 5; i++) this.col(gy + h, c);
    if (o.d) this.enemy('drone', this.x - 2, gy + h - 3);
    this.gy += h;
  }
  chimney(h, o = {}) {
    // 두 벽 사이를 벽 점프로 오르는 굴뚝
    const x0 = this.x, gy = this.gy, c = gy - h - this.rh;
    this.col(gy, gy - this.rh);
    this.col(gy, c);
    this.rect(x0 + 1, c, 1, (gy - 4) - c + 1);
    for (let i = 0; i < 4; i++) this.col(gy, c);
    for (let i = 0; i < 4; i++) this.col(gy - h, c);
    if (o.hint) this.hint(o.hint, x0);
    this.gy -= h;
  }
  spikes(n, o = {}) {
    const x0 = this.x, gy = this.gy, c = gy - this.rh + 1;
    for (let i = 0; i < n; i++) this.col(gy, c);
    this.rect(x0 + 1, gy - 1, n - 2, 1, T.SPIKE);
    for (let px = x0 + 4; px < x0 + n - 3; px += 6) this.rect(px, c + 1, 1, 2);
    if (o.d) for (let k = 0; k < o.d; k++) this.enemy('drone', x0 + Math.floor(n * (k + 1) / (o.d + 1)), gy - 4);
    if (o.t) for (let k = 0; k < o.t; k++) this.enemy('turret', x0 + Math.floor(n * (k + 1) / (o.t + 1)) + 2, c + 1);
    if (o.hint) this.hint(o.hint, x0);
  }
  arena(n, o = {}) {
    const x0 = this.x, gy = this.gy, c = gy - this.rh - 4;
    for (let i = 0; i < n; i++) this.col(gy, c);
    for (let px = x0 + 3, k = 0; px < x0 + n - 5; px += 7, k++) this.rect(px, gy - (k % 2 ? 8 : 4), 4, 1, T.ONEWAY);
    const save = this.rh; this.rh += 4;
    this.spread(x0, n, o);
    this.rh = save;
    for (let px = x0 + 5; px < x0 + n - 3; px += 9) this.ent('anchors', px, c + 3);
  }
  cp(o = {}) {
    const x0 = this.x;
    for (let i = 0; i < 6; i++) this.col(this.gy, this.gy - this.rh);
    this.ent('checkpoints', x0 + 3, this.gy - 1);
    if (o.h) this.ent('health', x0 + 1, this.gy - 2);
  }
  goal(o = {}) {
    const x0 = this.x;
    for (let i = 0; i < 9; i++) this.col(this.gy, this.gy - this.rh);
    this.col('wall'); this.col('wall');
    this.ent(o.race ? 'finish' : 'exit', x0 + 5, this.gy - 1);
    if (o.hint) this.hint(o.hint, x0);
  }

  build() {
    // 상대 행 좌표를 실제 맵 좌표로 변환
    let minR = Infinity, maxR = -Infinity;
    for (const c of this.cols) {
      if (c.f === 'wall') continue;
      if (c.c != null) minR = Math.min(minR, c.c); else if (c.f != null) minR = Math.min(minR, c.f - this.rh - 6);
      if (c.f != null) maxR = Math.max(maxR, c.f);
    }
    for (const e of this.ents.anchors) minR = Math.min(minR, e.y - 2);
    const shift = 3 - minR;
    const W = this.cols.length, H = maxR + shift + 7;
    const tiles = new Uint8Array(W * H);
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = v; };
    this.cols.forEach((c, x) => {
      if (c.f === 'wall') { for (let y = 0; y < H; y++) set(x, y, T.SOLID); return; }
      if (c.f != null) for (let y = c.f + shift; y < H; y++) set(x, y, T.SOLID);
      if (c.c != null) for (let y = 0; y <= c.c + shift; y++) set(x, y, T.SOLID);
    });
    for (const [x, y, w, h, v] of this.ops) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j + shift, v);
    return finalize(W, H, tiles, this.ents, shift);
  }
}

function finalize(W, H, tiles, ents, shift) {
  // 타일 좌표 → 픽셀 좌표
  const px = (o) => ({ ...o, x: o.x * TS + TS / 2, y: (o.y + shift) * TS + TS / 2 });
  const foot = (o) => ({ ...o, x: o.x * TS + TS / 2, y: (o.y + shift + 1) * TS - P.h / 2 - 0.5 });
  // 스파이크 방향(천장 스파이크 판정)
  for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (tiles[i] === T.SPIKE && tiles[i - W] === T.SOLID && (y + 1 >= H || tiles[i + W] !== T.SOLID)) tiles[i] = T.SPIKED;
  }
  return {
    W, H, tiles,
    spawn: ents.spawn ? foot(ents.spawn) : { x: 100, y: 100 },
    exit: ents.exit ? foot(ents.exit) : null,
    finish: ents.finish ? foot(ents.finish) : null,
    checkpoints: ents.checkpoints.map(foot),
    enemies: ents.enemies.map((e, i) => ({ ...px(e), id: i })),
    anchors: ents.anchors.map(px),
    health: ents.health.map(px),
    boosts: ents.boosts.map((b) => ({ x: b.x * TS + TS / 2, y: (b.y + shift + 1) * TS })),
    hints: ents.hints.map(px),
  };
}

function compose(seed, plan) {
  const c = new Composer(seed);
  for (const step of plan) {
    const [fn, ...args] = step;
    c[fn](...args);
  }
  return c.build();
}

// ---------- 보스 아레나 (수작업) ----------
function bossArena() {
  const W = 58, H = 34;
  const tiles = new Uint8Array(W * H);
  const rect = (x, y, w, h, v = T.SOLID) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < W && j < H) tiles[j * W + i] = v; };
  rect(0, 0, 2, H); rect(W - 2, 0, 2, H);
  rect(0, 0, W, 2);
  rect(0, 29, W, 5);
  rect(8, 22, 6, 1, T.ONEWAY); rect(W - 14, 22, 6, 1, T.ONEWAY);
  rect(24, 24, 10, 1, T.ONEWAY);
  rect(2, 15, 3, 1, T.ONEWAY); rect(W - 5, 15, 3, 1, T.ONEWAY);
  rect(14, 2, 2, 3); rect(W - 16, 2, 2, 3); rect(28, 2, 2, 2);
  const ents = {
    spawn: { x: 5, y: 28 }, exit: null, finish: null,
    checkpoints: [{ x: 5, y: 28, start: true }],
    enemies: [{ type: 'boss', x: 29, y: 11 }],
    anchors: [[8, 10], [19, 7], [38, 7], [49, 10], [6, 19], [51, 19], [29, 18], [16, 16], [42, 16]].map(([x, y]) => ({ x, y })),
    health: [{ x: 3, y: 13 }, { x: W - 4, y: 13 }], boosts: [], hints: [],
  };
  const lv = finalize(W, H, tiles, ents, 0);
  lv.exitLater = { x: 29 * TS + TS / 2, y: 29 * TS - P.h / 2 - 0.5 };
  return lv;
}

// ---------- 스테이지 목록 ----------
export const STAGES = [
  {
    id: 'tut', code: 'TRAINING', name: '훈련 구역', theme: 0, par: 150, seed: 7, tutorial: true,
    plan: [['start'], ['run', 9, { hint: 'move' }], ['run', 10, { hint: 'jump', blocks: [[5, 2, 2]] }],
      ['chimney', 8, { hint: 'wall' }], ['cp'], ['pit', 12, { hint: 'hook' }], ['run', 5],
      ['up', 8, { hint: 'reel' }], ['run', 9, { hint: 'dash' }], ['cp'],
      ['run', 12, { hint: 'snatch', e: 1 }], ['run', 9, { d: 1 }], ['sky', 15, { hint: 'swing' }],
      ['run', 5, { h: 1 }], ['goal', { hint: 'exit' }]],
  },
  {
    id: 's1', code: 'SECTOR 01', name: '빗속의 옥상', theme: 0, par: 95, seed: 11,
    plan: [['start'], ['run', 10, { e: 1 }], ['pit', 9], ['run', 8, { bump: 1 }], ['chimney', 7], ['run', 8, { d: 1 }], ['cp'],
      ['sky', 13], ['run', 6, { e: 1 }], ['pit', 12, { d: 1 }], ['cp', { h: 1 }], ['up', 6], ['run', 10, { e: 2 }],
      ['spikes', 10], ['run', 6], ['goal']],
  },
  {
    id: 's2', code: 'SECTOR 02', name: '네온 골목', theme: 1, par: 125, seed: 23,
    plan: [['start'], ['run', 8], ['pit', 11, { spk: 1 }], ['run', 6, { e: 1 }], ['arena', 18, { d: 2, t: 1 }], ['cp'],
      ['up', 7], ['pit', 13, { d: 1 }], ['down', 5], ['spikes', 12], ['cp', { h: 1 }], ['sky', 16],
      ['run', 8, { e: 2 }], ['chimney', 9], ['run', 7, { t: 1 }], ['goal']],
  },
  {
    id: 's3', code: 'SECTOR 03', name: '유리 회랑', theme: 2, par: 150, seed: 37,
    plan: [['start'], ['run', 6], ['pitGlass', 14], ['run', 6, { e: 1 }], ['cp'], ['arena', 20, { d: 3, t: 2 }], ['run', 4],
      ['up', 8], ['sky', 18], ['cp', { h: 1 }], ['spikes', 14, { d: 1 }], ['down', 6], ['pit', 14, { d: 2 }],
      ['run', 8, { e: 2, t: 1 }], ['goal']],
  },
  {
    id: 's4', code: 'SECTOR 04', name: '데이터 첨탑', theme: 3, par: 170, seed: 41,
    plan: [['start'], ['run', 6], ['chimney', 10], ['run', 5, { d: 1 }], ['up', 9], ['cp'], ['pitGlass', 16, { d: 1 }],
      ['chimney', 10], ['run', 6, { e: 1, t: 1 }], ['cp', { h: 1 }], ['sky', 20], ['up', 8],
      ['arena', 22, { d: 3, t: 2, h: 1 }], ['goal']],
  },
  {
    id: 's5', code: 'SECTOR 05', name: '본사 외벽', theme: 4, par: 200, seed: 53,
    plan: [['start'], ['run', 6, { e: 1 }], ['spikes', 14, { d: 1 }], ['pitGlass', 18, { d: 2 }], ['cp'], ['chimney', 11],
      ['arena', 24, { d: 4, t: 2, h: 1 }], ['cp'], ['sky', 22], ['down', 5], ['pit', 16, { spk: 1, d: 2 }], ['cp', { h: 1 }],
      ['up', 9], ['spikes', 16, { t: 1 }], ['run', 6], ['goal']],
  },
  { id: 'boss', code: 'CORE', name: '감시 코어', theme: 4, par: 120, boss: true },
];

export const COURSES = [
  {
    id: 'r1', code: 'COURSE A', name: '네온 질주', theme: 0, seed: 101,
    plan: [['start'], ['run', 6, { boost: 1 }], ['pit', 10], ['run', 4], ['sky', 14], ['up', 5], ['run', 6, { boost: 1 }],
      ['spikes', 10], ['cp'], ['down', 4], ['pit', 12], ['run', 6, { boost: 1 }], ['chimney', 7], ['sky', 16], ['goal', { race: 1 }]],
  },
  {
    id: 'r2', code: 'COURSE B', name: '스카이라인', theme: 1, seed: 202,
    plan: [['start'], ['sky', 12], ['run', 4, { boost: 1 }], ['pitGlass', 12], ['up', 6], ['sky', 18], ['cp'], ['down', 6],
      ['run', 6, { boost: 1 }], ['pit', 14], ['chimney', 8], ['sky', 14], ['goal', { race: 1 }]],
  },
  {
    id: 'r3', code: 'COURSE C', name: '오버드라이브', theme: 3, seed: 303,
    plan: [['start'], ['run', 6, { boost: 1 }], ['spikes', 14], ['chimney', 9], ['pitGlass', 16], ['cp'], ['sky', 20], ['down', 7],
      ['run', 4, { boost: 1 }], ['pit', 18, { spk: 1 }], ['cp'], ['up', 8], ['sky', 16], ['spikes', 12], ['goal', { race: 1 }]],
  },
];

const cache = new Map();
export function getLevel(def) {
  if (cache.has(def.id)) return cache.get(def.id);
  const lv = def.boss ? bossArena() : compose(def.seed, def.plan);
  lv.def = def;
  cache.set(def.id, lv);
  return lv;
}
export const findStage = (id) => STAGES.find((s) => s.id === id) || COURSES.find((s) => s.id === id);
