// DOM 메뉴 / 로비 / 결과 / 채팅
import { STAGES, COURSES } from './levels.js';
import { COLORS, COLOR_NAMES } from './config.js';
import { fmtTime, escapeHtml, store, isTouchDevice } from './util.js';
import { MAX_PLAYERS } from './net.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.chatOpen = false;
    this.cur = 's-title';
    this.setReturn = 's-title';
  }
  init(game) {
    this.g = game;
    if (isTouchDevice()) { document.body.classList.add('mobile'); game.input.setMode('touch'); }
    game.input.onMode = () => {};
    // 화면 이동 버튼
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { this.click(); this.show(b.dataset.go); }));
    $('goTut').addEventListener('click', () => { this.click(); this.g.start('coop', 'tut'); });
    // 첫 입력 시 오디오 시작
    const unlock = () => { this.g.snd.init(); this.g.snd.music(this.g.scene === 'play' ? this.g.snd.want : 'menu'); };
    window.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    this.bindOnline(); this.bindSettings(); this.bindGame();
    $('btnFull').addEventListener('click', () => this.fullscreen());
    window.addEventListener('keydown', (e) => this.key(e));
    this.g.snd.music('menu');
  }
  click() { this.g.snd.init(); this.g.snd.play('ui'); }
  show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
    this.cur = id;
    if (id === 's-stages') this.renderStages();
    if (id === 's-courses') this.renderCourses();
    if (id === 's-online') this.renderOnline();
    if (id === 's-settings') this.renderSettings();
  }
  hideAll() { document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on')); this.cur = null; }
  toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(this.tt); this.tt = setTimeout(() => t.classList.remove('on'), 3200);
  }
  fullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => this.toast('이 브라우저는 전체화면을 지원하지 않아요. 홈 화면에 추가해 실행해 보세요.'));
    } else this.toast('이 브라우저는 전체화면을 지원하지 않아요. 홈 화면에 추가해 실행해 보세요.');
  }

  // ---------- 스테이지/코스 목록 ----------
  renderStages() {
    const g = this.g, box = $('stageList');
    box.innerHTML = '';
    STAGES.forEach((s, i) => {
      const locked = i >= g.prog.unlocked;
      const rk = g.prog.ranks[s.id];
      const b = document.createElement('button');
      b.className = 'card' + (locked ? ' locked' : '');
      b.innerHTML = `<b>${s.code}</b><span>${escapeHtml(s.name)}</span><span>${g.prog.best[s.id] ? 'BEST ' + fmtTime(g.prog.best[s.id]) : '목표 ' + fmtTime(s.par)}</span>${rk ? `<i class="rk ${rk}">${rk}</i>` : ''}`;
      b.addEventListener('click', () => { this.click(); g.start('coop', s.id); });
      box.appendChild(b);
    });
  }
  renderCourses() {
    const g = this.g, box = $('courseList');
    box.innerHTML = '';
    COURSES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'card';
      const best = g.prog.best[c.id];
      b.innerHTML = `<b>${c.code}</b><span>${escapeHtml(c.name)}</span><span>${best ? 'BEST ' + fmtTime(best) + ' · 고스트 있음' : '기록 없음'}</span>`;
      b.addEventListener('click', () => { this.click(); g.start('race', c.id); });
      box.appendChild(b);
    });
  }

  // ---------- 온라인 ----------
  renderOnline() {
    const s = this.g.settings;
    $('nameIn').value = s.name;
    const sw = $('swatches'); sw.innerHTML = '';
    COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'sw' + (s.color === i ? ' on' : '');
      b.style.background = c; b.style.color = c; b.title = COLOR_NAMES[i];
      b.addEventListener('click', () => { s.color = i; this.g.saveSettings(); this.renderOnline(); this.click(); });
      sw.appendChild(b);
    });
  }
  bindOnline() {
    const g = this.g;
    const saveName = () => { const v = $('nameIn').value.trim().slice(0, 12); if (v) { g.settings.name = v; g.saveSettings(); } };
    $('nameIn').addEventListener('change', saveName);
    $('btnHost').addEventListener('click', async () => {
      this.click(); saveName();
      const b = $('btnHost'); b.disabled = true; b.textContent = '방 만드는 중...';
      try {
        const code = await g.host();
        $('roomCode').textContent = code;
        $('lobbyChat').innerHTML = '';
        this.chatSys('방이 만들어졌어요. 코드 ' + code + ' 를 공유하세요.');
        this.showLobby();
      } catch (e) { this.toast(e.message); } finally { b.disabled = false; b.textContent = '방 만들기'; }
    });
    const join = async () => {
      this.click(); saveName();
      const code = $('codeIn').value.trim().toUpperCase();
      if (code.length !== 5) { this.toast('5자리 방 코드를 입력하세요.'); return; }
      const b = $('btnJoin'); b.disabled = true; b.textContent = '연결 중...';
      try {
        await g.join(code);
        $('roomCode').textContent = code;
        $('lobbyChat').innerHTML = '';
        this.chatSys('방에 참가했어요.');
        this.showLobby();
      } catch (e) { this.toast(e.message); } finally { b.disabled = false; b.textContent = '참가'; }
    };
    $('btnJoin').addEventListener('click', join);
    $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('btnCopy').addEventListener('click', () => {
      const code = $('roomCode').textContent;
      const done = () => this.toast('방 코드 ' + code + ' 를 복사했어요.');
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => this.toast('코드: ' + code));
      else this.toast('코드: ' + code);
    });
    $('btnLeave').addEventListener('click', () => { this.click(); g.leaveOnline(); this.show('s-online'); });
    $('btnStart').addEventListener('click', () => { this.click(); g.hostStart(); });
    $('modeTabs').addEventListener('click', (e) => {
      const m = e.target.closest('button'); if (!m || !g.net.host) return;
      this.click();
      g.setLobbySel({ mode: m.dataset.mode, id: m.dataset.mode === 'race' ? COURSES[0].id : 'tut' });
    });
    $('lobbyForm').addEventListener('submit', (e) => { e.preventDefault(); g.sendChat($('lobbyIn').value); $('lobbyIn').value = ''; });
  }
  showLobby() {
    this.show('s-lobby');
    document.body.classList.remove('playing');
    $('hud').classList.add('hidden');
    this.renderLobby({ players: [...this.g.roster.entries()].map(([i, p]) => ({ i, ...p })), sel: this.g.lobbySel });
  }
  renderLobby(m) {
    const g = this.g, host = g.net.host;
    if (this.cur !== 's-lobby') return;
    const ul = $('plist'); ul.innerHTML = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = m.players.find((q) => q.i === i);
      const li = document.createElement('li');
      if (p) { li.style.borderLeftColor = COLORS[p.color]; li.style.color = COLORS[p.color]; li.innerHTML = `<span>${escapeHtml(p.name)}</span>${i === 0 ? '<em>HOST</em>' : ''}${i === g.net.slot ? '<em>YOU</em>' : ''}`; }
      else { li.className = 'empty'; li.textContent = '빈 자리'; }
      ul.appendChild(li);
    }
    const sel = m.sel || { mode: 'coop', id: 'tut' };
    $('modeTabs').classList.toggle('hidden', !host);
    $('selList').classList.toggle('hidden', !host);
    $('btnStart').classList.toggle('hidden', !host);
    $('modeTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === sel.mode));
    const list = sel.mode === 'race' ? COURSES : STAGES;
    const cur = list.find((s) => s.id === sel.id) || list[0];
    $('selView').innerHTML = `${sel.mode === 'race' ? '레이스' : '협동'} · <span style="font-family:Orbitron">${cur.code}</span> ${escapeHtml(cur.name)}${host ? '' : '<br><small style="color:var(--dim)">호스트가 시작하길 기다리는 중...</small>'}`;
    if (host) {
      const box = $('selList'); box.innerHTML = '';
      list.forEach((s, i) => {
        const locked = sel.mode !== 'race' && i >= g.prog.unlocked;
        const b = document.createElement('button');
        b.className = s.id === sel.id ? 'on' : '';
        b.disabled = locked;
        if (locked) b.style.opacity = 0.35;
        b.innerHTML = `<b>${s.code}</b>${escapeHtml(s.name)}`;
        b.addEventListener('click', () => { this.click(); g.setLobbySel({ mode: sel.mode, id: s.id }); });
        box.appendChild(b);
      });
    }
  }
  chatSys(text) {
    const box = $('lobbyChat');
    const d = document.createElement('div'); d.className = 'sys'; d.textContent = text;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  chatLine(name, color, text) {
    const html = `<b style="color:${color}">${escapeHtml(name)}</b>${escapeHtml(text)}`;
    const box = $('lobbyChat');
    const d = document.createElement('div'); d.innerHTML = html; box.appendChild(d);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    const log = $('chatLog');
    const l = document.createElement('div'); l.className = 'chatline'; l.innerHTML = html; log.appendChild(l);
    while (log.children.length > 6) log.removeChild(log.firstChild);
    setTimeout(() => l.classList.add('fade'), 7000);
    setTimeout(() => l.remove(), 8200);
  }

  // ---------- 설정 ----------
  renderSettings() {
    const s = this.g.settings;
    $('optFx').value = s.fx; $('optShake').checked = s.shake; $('optQ').value = String(s.quality);
    $('optSfx').value = s.sfx; $('optBgm').value = s.bgm; $('optFps').checked = s.fps; $('optName').value = s.name;
  }
  bindSettings() {
    const g = this.g, s = g.settings;
    const upd = () => {
      s.fx = +$('optFx').value; s.shake = $('optShake').checked;
      const q = $('optQ').value; s.quality = q === 'auto' ? 'auto' : +q;
      s.sfx = +$('optSfx').value; s.bgm = +$('optBgm').value; s.fps = $('optFps').checked;
      const n = $('optName').value.trim().slice(0, 12); if (n) s.name = n;
      g.saveSettings();
    };
    ['optFx', 'optShake', 'optQ', 'optSfx', 'optBgm', 'optFps', 'optName'].forEach((id) => $(id).addEventListener('change', upd));
    $('optSfx').addEventListener('input', () => { upd(); g.snd.play('ui'); });
    $('optBgm').addEventListener('input', upd);
    $('btnReset').addEventListener('click', () => {
      if (!confirm('모든 랭크, 기록, 고스트를 지울까요?')) return;
      g.prog = { ranks: {}, unlocked: 1, best: {} }; g.saveProg();
      [...STAGES, ...COURSES].forEach((c) => store.del('ghost_' + c.id));
      this.toast('기록을 초기화했어요.');
    });
    $('setBack').addEventListener('click', () => { this.click(); this.show(this.setReturn); });
    document.querySelector('[data-go="s-settings"]').addEventListener('click', () => { this.setReturn = 's-title'; });
  }

  // ---------- 인게임 ----------
  bindGame() {
    const g = this.g;
    $('btnPause').addEventListener('click', () => this.pause());
    $('pResume').addEventListener('click', () => this.resume());
    $('pCp').addEventListener('click', () => {
      if (g.me && !g.me.dead) { const hp = g.me.hp; g.respawn(g.me); g.me.hp = hp; }
      this.resume();
    });
    $('pRetry').addEventListener('click', () => { this.click(); g.start(g.mode, g.def.id); });
    $('pSet').addEventListener('click', () => { this.click(); this.setReturn = 's-pause'; this.show('s-settings'); });
    $('pQuit').addEventListener('click', () => { this.click(); this.exitGame(); });
    $('btnChat').addEventListener('click', () => this.openChat());
    $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); g.sendChat($('chatInput').value); this.closeChat(); });
    $('chatInput').addEventListener('blur', () => setTimeout(() => this.closeChat(), 100));
    // 결과 화면
    $('rNext').addEventListener('click', () => { this.click(); this.nextStage(); });
    $('rRetry').addEventListener('click', () => { this.click(); this.replay(); });
    $('rMenu').addEventListener('click', () => { this.click(); this.exitGame(); });
    $('raRetry').addEventListener('click', () => { this.click(); this.replay(); });
    $('raMenu').addEventListener('click', () => { this.click(); this.exitGame(); });
    // 탭 전환 시 자동 일시정지
    document.addEventListener('visibilitychange', () => { if (document.hidden && g.scene === 'play' && !g.done) this.pause(); });
  }
  key(e) {
    const g = this.g;
    if (g.scene !== 'play') return;
    if (e.code === 'Escape') {
      if (this.chatOpen) { this.closeChat(); return; }
      if (this.cur === 's-pause') this.resume(); else if (!this.cur) this.pause();
    } else if (e.code === 'Enter' && g.net.online && !this.chatOpen && !this.cur) {
      e.preventDefault(); this.openChat();
    } else if (e.code === 'KeyR' && !this.cur && !g.net.online && !this.chatOpen && g.me && !g.me.dead && e.ctrlKey === false) {
      // R: 체크포인트로 (끼임 방지)
      const hp = g.me.hp; g.respawn(g.me); g.me.hp = hp;
    }
  }
  openChat() {
    this.chatOpen = true; $('chatForm').classList.remove('hidden');
    this.g.input.reset();
    const i = $('chatInput'); i.value = ''; setTimeout(() => i.focus(), 0);
  }
  closeChat() { if (!this.chatOpen) return; this.chatOpen = false; $('chatForm').classList.add('hidden'); $('chatInput').blur(); }
  pause() {
    const g = this.g;
    if (g.scene !== 'play' || g.done) return;
    this.click();
    if (!g.net.online) g.paused = true;
    g.input.reset();
    $('pRetry').classList.toggle('hidden', g.net.online);
    $('pQuit').textContent = g.net.online ? (g.net.host ? '로비로 돌아가기 (전원)' : '방 나가기') : '나가기';
    this.show('s-pause');
  }
  resume() { this.click(); this.g.paused = false; this.hideAll(); }
  onStart(mode, def) {
    this.hideAll();
    $('hud').classList.remove('hidden');
    document.body.classList.add('playing');
    $('btnChat').classList.toggle('hidden', !this.g.net.online);
    $('chatLog').innerHTML = '';
  }
  exitGame() {
    const g = this.g;
    g.paused = false;
    document.body.classList.remove('playing');
    $('hud').classList.add('hidden');
    if (g.net.online) {
      if (g.net.host) { g.backToLobby(); return; }
      g.leaveOnline(); g.quitToMenu(); this.show('s-online'); return;
    }
    g.quitToMenu();
    this.show(g.mode === 'race' ? 's-courses' : g.def && g.def.tutorial ? 's-solo' : 's-stages');
  }
  goMenu() { document.body.classList.remove('playing'); $('hud').classList.add('hidden'); this.show('s-online'); }
  nextStage() {
    const g = this.g, i = STAGES.findIndex((s) => s.id === g.def.id), n = STAGES[i + 1];
    if (!n) return;
    if (g.net.online) { g.lobbySel = { mode: 'coop', id: n.id }; g.hostStart(); } else g.start('coop', n.id);
  }
  replay() {
    const g = this.g;
    if (g.net.online) { g.lobbySel = { mode: g.mode, id: g.def.id }; g.hostStart(); } else g.start(g.mode, g.def.id);
  }
  showResult(o) {
    const g = this.g;
    if (g.scene !== 'play') return;
    $('rCode').textContent = o.def.code + ' · ' + o.def.name;
    const rk = $('rRank'); rk.textContent = o.rank; rk.className = 'rank ' + o.rank;
    $('rTime').textContent = fmtTime(o.time); $('rPar').textContent = fmtTime(o.par);
    $('rKills').textContent = o.stats.kills; $('rDmg').textContent = o.stats.dmg + ' / ' + o.stats.deaths;
    $('rNext').classList.toggle('hidden', !o.next);
    $('rNext').textContent = o.next && o.next.boss ? '보스전으로' : '다음 스테이지';
    const online = g.net.online, host = g.net.host;
    $('rBtns').classList.toggle('hidden', online && !host);
    $('rWait').classList.toggle('hidden', !(online && !host));
    $('rMenu').textContent = online ? '로비로' : '메뉴';
    this.updateTeam(o.team);
    this.show('s-result');
    document.body.classList.remove('playing');
  }
  updateTeam(map) {
    const box = $('rTeam');
    if (!this.g.net.online) { box.innerHTML = ''; return; }
    box.innerHTML = [...map.values()].sort((a, b) => a.slot - b.slot).map((s) => `<div style="border-left-color:${s.color}"><b style="color:${s.color}">${escapeHtml(s.name)}</b><span>처치 ${s.kills} · 피격 ${s.dmg} · 쓰러짐 ${s.deaths}</span></div>`).join('');
  }
  showRace(o) {
    const g = this.g;
    if (g.scene !== 'play') return;
    $('raCode').textContent = o.def.code + ' · ' + o.def.name;
    $('raTime').textContent = fmtTime(o.time); $('raBest').textContent = fmtTime(o.best);
    $('raNew').classList.toggle('hidden', !o.isBest);
    const online = g.net.online, host = g.net.host;
    $('raBtns').classList.toggle('hidden', online && !host);
    $('raMenu').textContent = online ? '로비로' : '메뉴';
    this.updateRace(o.standings);
    this.show('s-race');
    document.body.classList.remove('playing');
  }
  updateRace(list) {
    const g = this.g;
    const ol = $('raList');
    if (!g.net.online) { ol.innerHTML = ''; $('raWait').classList.add('hidden'); return; }
    ol.innerHTML = list.map((r) => `<li style="border-left-color:${COLORS[r.color]}"><span style="color:${COLORS[r.color]}">${escapeHtml(r.name)}</span><i>${fmtTime(r.time)}</i></li>`).join('');
    $('raWait').classList.toggle('hidden', list.length >= g.roster.size);
    if (!g.net.host) $('raWait').textContent = list.length >= g.roster.size ? '' : '다른 플레이어를 기다리는 중...';
  }
}
