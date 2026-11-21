// 타일 월드: 충돌, 레이캐스트
import { TS, T } from './config.js';

export class World {
  constructor(lv) {
    this.lv = lv;
    this.W = lv.W; this.H = lv.H; this.tiles = lv.tiles;
    this.pw = lv.W * TS; this.ph = lv.H * TS;
  }
  at(tx, ty) {
    if (tx < 0 || tx >= this.W) return T.SOLID; // 좌우 경계는 벽
    if (ty < 0 || ty >= this.H) return T.EMPTY; // 위는 하늘, 아래는 낭떠러지
    return this.tiles[ty * this.W + tx];
  }
  solidAt(tx, ty) { const t = this.at(tx, ty); return t === T.SOLID || t === T.GLASS; }
  // 와이어가 박히는 지점인가
  hookTile(px, py) {
    const t = this.at(Math.floor(px / TS), Math.floor(py / TS));
    return t === T.SOLID ? 1 : t === T.GLASS ? 2 : 0;
  }
  // AABB가 고체와 겹치는가 (cx,cy 중심, hw,hh 반폭)
  boxSolid(cx, cy, hw, hh) {
    const x0 = Math.floor((cx - hw) / TS), x1 = Math.floor((cx + hw - 0.001) / TS);
    const y0 = Math.floor((cy - hh) / TS), y1 = Math.floor((cy + hh - 0.001) / TS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.solidAt(x, y)) return true;
    return false;
  }
  // 한 방향 발판: 아래로 이동 중 이전 발바닥이 발판 위였을 때만 충돌
  onewayBelow(cx, prevBottom, newBottom, hw) {
    const x0 = Math.floor((cx - hw) / TS), x1 = Math.floor((cx + hw - 0.001) / TS);
    const ty = Math.floor(newBottom / TS);
    const top = ty * TS;
    if (prevBottom > top + 0.5 || newBottom < top) return -1;
    for (let x = x0; x <= x1; x++) if (this.at(x, ty) === T.ONEWAY) return top;
    return -1;
  }
  // 선분 시야(LOS) 검사: 고체 타일에 막히면 false
  los(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const n = Math.ceil(len / 12);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.solidAt(Math.floor((x1 + dx * t) / TS), Math.floor((y1 + dy * t) / TS))) return false;
    }
    return true;
  }
  // DDA 레이캐스트: 첫 고체 타일까지. {x,y,d,kind}
  ray(x, y, dx, dy, maxD) {
    let tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(TS / dx) : Infinity, tdy = dy !== 0 ? Math.abs(TS / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? ((tx + 1) * TS - x) / dx : (tx * TS - x) / dx) : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? ((ty + 1) * TS - y) / dy : (ty * TS - y) / dy) : Infinity;
    let d = 0;
    for (let i = 0; i < 64; i++) {
      if (tmx < tmy) { d = tmx; tmx += tdx; tx += stepX; } else { d = tmy; tmy += tdy; ty += stepY; }
      if (d > maxD) return null;
      const t = this.at(tx, ty);
      if (t === T.SOLID || t === T.GLASS) return { x: x + dx * d, y: y + dy * d, d, kind: t === T.SOLID ? 1 : 2 };
      if (ty >= this.H && dy > 0) return null;
    }
    return null;
  }
}
