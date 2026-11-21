// WebAudio 합성 효과음 + 신스웨이브 BGM (외부 음원 없음)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const TRACKS = {
  menu: { bpm: 92, prog: [[45, 0], [41, 1], [48, 1], [43, 1]], drums: 0, arp: 1, bass: 1, swing: 0 },
  stage: { bpm: 118, prog: [[45, 0], [41, 1], [48, 1], [43, 1], [50, 0], [45, 0], [41, 1], [40, 1]], drums: 2, arp: 2, bass: 2 },
  boss: { bpm: 142, prog: [[40, 0], [36, 1], [38, 1], [35, 1]], drums: 3, arp: 3, bass: 3 },
  race: { bpm: 134, prog: [[42, 0], [38, 1], [45, 1], [40, 1]], drums: 2, arp: 3, bass: 2 },
  tut: { bpm: 104, prog: [[43, 1], [40, 0], [36, 1], [38, 1]], drums: 1, arp: 1, bass: 1 },
};

export class Sound {
  constructor() {
    this.ctx = null; this.sfxVol = 0.8; this.bgmVol = 0.55;
    this.last = {}; this.track = null; this.want = null;
    this.step = 0; this.next = 0; this.timer = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = this.bgmVol * 0.5; this.mus.connect(this.master);
    // 노이즈 버퍼
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 간단한 딜레이(공간감)
    this.delay = c.createDelay(); this.delay.delayTime.value = 0.28;
    const fb = c.createGain(); fb.gain.value = 0.28;
    const dw = c.createGain(); dw.gain.value = 0.22;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(dw); dw.connect(this.mus);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
    if (this.want) this.music(this.want, true);
  }
  setVol(sfx, bgm) {
    this.sfxVol = sfx; this.bgmVol = bgm;
    if (this.ctx) { this.sfx.gain.value = sfx; this.mus.gain.value = bgm * 0.5; }
  }

  // ---------- 기본 음원 ----------
  osc(type, f0, f1, dur, vol, t = 0, out) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g); g.connect(out || this.sfx);
    o.start(now); o.stop(now + dur + 0.02);
  }
  nz(dur, vol, ftype, f0, f1, t = 0, out, q = 1) {
    const c = this.ctx, now = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 1;
    const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    s.connect(f); f.connect(g); g.connect(out || this.sfx);
    s.start(now, Math.random() * 0.5); s.stop(now + dur + 0.02);
  }

  play(name, v = 1) {
    if (!this.ctx || this.sfxVol <= 0) return;
    const t = this.ctx.currentTime;
    if (this.last[name] && t - this.last[name] < 0.03) return;
    this.last[name] = t;
    switch (name) {
      case 'shoot': this.osc('square', 900, 260, 0.08, 0.09 * v); this.nz(0.05, 0.08, 'highpass', 3000, 3000); break;
      case 'attach': this.osc('triangle', 1500, 700, 0.06, 0.18); this.nz(0.04, 0.15, 'bandpass', 2500, 1200, 0, null, 3); break;
      case 'anchor': this.osc('sine', 1320, 1320, 0.15, 0.12); this.osc('triangle', 660, 640, 0.08, 0.12); break;
      case 'jump': this.osc('sine', 280, 560, 0.1, 0.12); break;
      case 'wjump': this.osc('sine', 360, 760, 0.1, 0.12); this.nz(0.05, 0.08, 'highpass', 2000, 2000); break;
      case 'hjump': this.osc('triangle', 400, 900, 0.14, 0.12); break;
      case 'dash': this.nz(0.2, 0.25, 'bandpass', 3200, 400, 0, null, 2); this.osc('sawtooth', 220, 110, 0.12, 0.05); break;
      case 'snatch': this.osc('sawtooth', 300, 1200, 0.15, 0.07); this.nz(0.12, 0.12, 'bandpass', 1500, 4000, 0, null, 2); break;
      case 'kill':
        this.osc('sawtooth', 180, 40, 0.32, 0.18); this.nz(0.3, 0.3, 'lowpass', 4000, 200);
        this.osc('sine', 1760, 1760, 0.25, 0.1, 0.02); break;
      case 'hurt': this.osc('square', 240, 90, 0.25, 0.14); this.nz(0.15, 0.2, 'lowpass', 2000, 300); break;
      case 'land': this.nz(0.06, 0.12 * v, 'lowpass', 900, 200); break;
      case 'cp': [0, 4, 7, 12].forEach((s, i) => this.osc('triangle', mtof(72 + s), mtof(72 + s), 0.25, 0.1, i * 0.07)); break;
      case 'heal': [0, 7, 12].forEach((s, i) => this.osc('sine', mtof(79 + s), mtof(79 + s), 0.2, 0.1, i * 0.05)); break;
      case 'deflect': this.osc('sine', 1900, 1700, 0.18, 0.1); this.osc('sine', 2650, 2500, 0.15, 0.07); break;
      case 'eshot': this.osc('square', 700, 220, 0.09, 0.035 * v); break;
      case 'charge': this.osc('sine', 300, 900, 0.4, 0.03); break;
      case 'laser': this.osc('sawtooth', 70, 60, 1.6, 0.08, 0.85); this.osc('sine', 1200, 300, 0.85, 0.05); break;
      case 'boom': this.nz(0.9, 0.5, 'lowpass', 1500, 60); this.osc('sine', 90, 30, 0.8, 0.4); break;
      case 'bosshit': this.osc('square', 140, 60, 0.4, 0.2); this.nz(0.4, 0.3, 'lowpass', 3000, 100); break;
      case 'shield': this.osc('triangle', 500, 800, 0.3, 0.08); this.osc('triangle', 750, 1200, 0.3, 0.06); break;
      case 'boost': this.osc('sawtooth', 300, 1400, 0.25, 0.07); this.nz(0.2, 0.1, 'highpass', 1500, 6000); break;
      case 'beep': this.osc('square', 660, 660, 0.12, 0.08); break;
      case 'go': this.osc('square', 1320, 1320, 0.3, 0.09); this.osc('square', 990, 990, 0.3, 0.06); break;
      case 'ui': this.osc('triangle', 1000, 1400, 0.05, 0.07); break;
      case 'uiback': this.osc('triangle', 900, 500, 0.06, 0.07); break;
      case 'clear': [0, 4, 7, 11, 12, 16].forEach((s, i) => this.osc('triangle', mtof(69 + s), mtof(69 + s), 0.4, 0.08, i * 0.08)); break;
      case 'chat': this.osc('sine', 1600, 2000, 0.06, 0.05); break;
      case 'die': this.osc('sawtooth', 400, 50, 0.6, 0.15); this.nz(0.5, 0.25, 'lowpass', 2500, 100); break;
      default: break;
    }
  }

  // ---------- 음악 ----------
  music(name, force) {
    this.want = name;
    if (!this.ctx) return;
    if (this.track === name && !force) return;
    this.track = name;
    clearInterval(this.timer);
    if (!name) return;
    this.tdef = TRACKS[name];
    this.step = 0; this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  schedule() {
    const c = this.ctx, T = this.tdef;
    if (!c || c.state !== 'running') return;
    const sd = 60 / T.bpm / 4;
    while (this.next < c.currentTime + 0.15) {
      this.note(this.step, this.next, sd);
      this.next += sd; this.step++;
    }
  }
  note(st, t, sd) {
    const T = this.tdef, s16 = st % 16, bar = Math.floor(st / 16);
    const [root, maj] = T.prog[bar % T.prog.length];
    const ch = maj ? [0, 4, 7, 11] : [0, 3, 7, 10];
    const dt = t - this.ctx.currentTime;
    const out = this.mus;
    // 드럼
    if (T.drums) {
      if (s16 % 4 === 0) this.kick(t);
      if (T.drums >= 2 && (s16 === 4 || s16 === 12)) this.nz(0.16, 0.3, 'highpass', 1400, 900, dt, out);
      if (T.drums >= 1 && s16 % 2 === 1) this.nz(0.04, T.drums >= 3 ? 0.16 : 0.1, 'highpass', 8000, 8000, dt, out);
      if (T.drums >= 3 && s16 % 4 === 2) this.nz(0.03, 0.08, 'highpass', 9000, 9000, dt, out);
    } else if (s16 === 0) this.kick(t, 0.5);
    // 베이스
    if (T.bass) {
      const pat = T.bass >= 3 ? [1, 1, 1, 1] : T.bass === 2 ? [1, 0, 1, 1] : [1, 0, 0, 0];
      if (s16 % 2 === 0 && pat[(s16 / 2) % 4]) {
        const n = root + (s16 % 8 === 6 && T.bass >= 2 ? 12 : 0) - 12;
        this.synth('sawtooth', mtof(n + 12), sd * 1.8, 0.14, 500 + T.bass * 200, dt, out);
      }
    }
    // 아르페지오
    if (T.arp) {
      const rate = T.arp >= 3 ? 1 : T.arp === 2 ? 2 : 4;
      if (s16 % rate === 0) {
        const idx = (s16 / rate) % 4;
        const oct = (Math.floor(s16 / 8) % 2) * 12;
        const n = root + 24 + ch[[0, 2, 1, 3][idx]] + oct;
        this.synth('square', mtof(n), sd * rate * 0.9, 0.045, 2600, dt, this.delay);
        this.synth('square', mtof(n), sd * rate * 0.9, 0.035, 2600, dt, out);
      }
    }
    // 패드
    if (s16 === 0) {
      for (const k of [0, 1, 2]) {
        this.synth('sawtooth', mtof(root + 12 + ch[k]) * 1.003, sd * 16, 0.028, 900, dt, out, 0.25);
        this.synth('sawtooth', mtof(root + 12 + ch[k]) * 0.997, sd * 16, 0.028, 900, dt, out, 0.25);
      }
    }
  }
  kick(t, v = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.55 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.3);
  }
  synth(type, f, dur, vol, cut, dt, out, atk = 0.005) {
    const c = this.ctx, t = c.currentTime + Math.max(0, dt);
    const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = type; o.frequency.value = f;
    fl.type = 'lowpass'; fl.frequency.value = cut; fl.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(fl); fl.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
}
