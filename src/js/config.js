// 게임 전역 상수
export const TS = 32; // 타일 크기(px)
export const STEP = 1 / 120; // 고정 물리 스텝

export const T = { EMPTY: 0, SOLID: 1, GLASS: 2, ONEWAY: 3, SPIKE: 4, SPIKED: 5 };

export const P = {
  w: 18, h: 28,
  grav: 1900, maxFall: 1050,
  runMax: 310, accG: 5200, accA: 2700, fricG: 3400, fricA: 500,
  jumpV: 640, coyote: 0.1, buffer: 0.13, jumpCut: 0.5,
  wallSlide: 170, wjVx: 390, wjVy: 610, wjLock: 0.15,
  dashV: 860, dashT: 0.14, dashCD: 0.38, dashI: 0.22,
  hookSpd: 3400, hookRange: 410, reel: 480, swingAcc: 1350, minRope: 34,
  snatchV: 1700, snatchMax: 0.55,
  maxHp: 5, hurtI: 1.1, respawnT: 1.8,
};

export const COLORS = ['#00f0ff', '#ff2bd6', '#ffe600', '#39ff14', '#ff8a1f', '#a77bff', '#ff3b5c', '#e8f4ff'];
export const COLOR_NAMES = ['시안', '마젠타', '옐로', '라임', '오렌지', '바이올렛', '레드', '화이트'];

// 스테이지 테마 (배경 하늘/네온 포인트)
export const THEMES = [
  { sky: ['#05010f', '#1a0533', '#4a0b4f'], edge: '#00f0ff', edge2: '#ff2bd6', fog: 'rgba(255,43,214,0.10)', win: ['#ffcf6b', '#00f0ff', '#ff6bd8'], rain: 1 },
  { sky: ['#02040f', '#071a3a', '#0d3d5c'], edge: '#39ff9c', edge2: '#00b3ff', fog: 'rgba(0,179,255,0.10)', win: ['#7dffcf', '#00b3ff', '#ffe66b'], rain: 1 },
  { sky: ['#0a0205', '#2b0612', '#5c1020'], edge: '#ff8a1f', edge2: '#ff2b55', fog: 'rgba(255,90,40,0.10)', win: ['#ffb36b', '#ff4d6d', '#ffe9a8'], rain: 0.5 },
  { sky: ['#03010a', '#140a33', '#2d1170'], edge: '#a77bff', edge2: '#00f0ff', fog: 'rgba(167,123,255,0.12)', win: ['#c9a8ff', '#00f0ff', '#ff8af0'], rain: 0.8 },
  { sky: ['#000000', '#0a0014', '#33001f'], edge: '#ff2b55', edge2: '#ffe600', fog: 'rgba(255,43,85,0.12)', win: ['#ff5c7a', '#ffe600', '#ffffff'], rain: 0.3 },
];
