// P2P 네트워킹 (PeerJS / WebRTC). 호스트 중심 스타 구조: 참가자 ↔ 호스트 ↔ 참가자
const PREFIX = 'neontether-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;

const PEER_OPTS = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] },
};

export class Net {
  constructor() {
    this.peer = null; this.host = false; this.online = false;
    this.clients = new Map(); // slot -> conn (호스트)
    this.hostConn = null; this.slot = 0; this.code = '';
    this.onMsg = () => {}; this.onJoin = () => {}; this.onLeave = () => {}; this.onClose = () => {};
    this.acceptJoin = () => true;
    this.seen = new Map(); this.hostSeen = 0; this.hb = 0;
  }
  // 하트비트: 응답 없는 연결을 정리한다 (창을 그냥 닫은 경우 등)
  startHeartbeat() {
    clearInterval(this.hb);
    this.hostSeen = Date.now();
    this.hb = setInterval(() => {
      if (!this.online) { clearInterval(this.hb); return; }
      const now = Date.now();
      if (this.host) {
        this.broadcast({ t: 'pi' });
        for (const [slot, c] of this.clients) {
          if (now - (this.seen.get(slot) || now) > 20000) { this.clients.delete(slot); try { c.close(); } catch (e) { /* noop */ } this.onLeave(slot); }
        }
      } else {
        if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'pi' });
        if (now - this.hostSeen > 20000) { this.online = false; clearInterval(this.hb); this.onClose('호스트의 응답이 없어 연결을 종료했어요.'); }
      }
    }, 2000);
  }
  available() { return typeof window.Peer === 'function'; }
  genCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

  createRoom() {
    return new Promise((res, rej) => {
      if (!this.available()) return rej(new Error('네트워크 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
      let tries = 0;
      const attempt = () => {
        const code = this.genCode();
        const peer = new window.Peer(PREFIX + code, PEER_OPTS);
        let done = false;
        peer.on('open', () => {
          done = true;
          this.peer = peer; this.host = true; this.online = true; this.code = code; this.slot = 0;
          peer.on('connection', (conn) => this.handleIncoming(conn));
          this.startHeartbeat();
          peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* noop */ } });
          res(code);
        });
        peer.on('error', (err) => {
          if (!done && err.type === 'unavailable-id' && tries++ < 4) { peer.destroy(); attempt(); return; }
          if (!done) { peer.destroy(); rej(new Error(errMsg(err))); }
        });
      };
      attempt();
    });
  }
  handleIncoming(conn) {
    conn.on('open', () => {
      const meta = conn.metadata || {};
      const used = new Set([0, ...this.clients.keys()]);
      let slot = -1;
      for (let i = 1; i < MAX_PLAYERS; i++) if (!used.has(i)) { slot = i; break; }
      const reason = slot < 0 ? '방이 가득 찼어요.' : this.acceptJoin(meta);
      if (reason !== true) {
        conn.send({ t: 'reject', r: typeof reason === 'string' ? reason : '참가할 수 없어요.' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      conn.slot = slot;
      this.clients.set(slot, conn);
      this.seen.set(slot, Date.now());
      conn.on('data', (m) => { this.seen.set(slot, Date.now()); if (m && m.t !== 'pi') this.onMsg(m, slot); });
      const gone = () => { if (this.clients.get(slot) === conn) { this.clients.delete(slot); this.onLeave(slot); } };
      conn.on('close', gone); conn.on('error', gone);
      this.onJoin(slot, meta);
    });
  }
  joinRoom(code, meta) {
    return new Promise((res, rej) => {
      if (!this.available()) return rej(new Error('네트워크 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
      code = code.trim().toUpperCase();
      const peer = new window.Peer(PEER_OPTS);
      let settled = false;
      const fail = (msg) => { if (settled) return; settled = true; clearTimeout(to); try { peer.destroy(); } catch (e) { /* noop */ } rej(new Error(msg)); };
      const to = setTimeout(() => fail('연결 시간이 초과됐어요. 코드를 확인하거나 다시 시도해 주세요.'), 12000);
      peer.on('error', (err) => fail(errMsg(err)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: meta });
        conn.on('data', (m) => {
          if (!settled) {
            if (m.t === 'reject') return fail(m.r);
            if (m.t === 'welcome') {
              settled = true; clearTimeout(to);
              this.peer = peer; this.hostConn = conn; this.host = false; this.online = true; this.code = code; this.slot = m.slot;
              this.startHeartbeat();
              res(m);
            }
            return;
          }
          this.hostSeen = Date.now();
          if (m && m.t !== 'pi') this.onMsg(m, 0);
        });
        const closed = () => { if (settled && this.online) { this.online = false; this.onClose('호스트와의 연결이 끊어졌어요.'); } else fail('방에 연결하지 못했어요.'); };
        conn.on('close', closed); conn.on('error', closed);
      });
    });
  }
  // 참가자 → 호스트, 호스트 → 전체
  send(m) {
    if (!this.online) return;
    if (this.host) this.broadcast(m);
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(m);
  }
  broadcast(m, except = -1) {
    for (const [slot, c] of this.clients) if (slot !== except && c.open) c.send(m);
  }
  sendTo(slot, m) { const c = this.clients.get(slot); if (c && c.open) c.send(m); }
  kick(slot) { const c = this.clients.get(slot); if (c) { c.close(); this.clients.delete(slot); } }
  close() {
    this.online = false; clearInterval(this.hb); this.seen.clear();
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* noop */ }
    this.peer = null; this.hostConn = null; this.clients.clear(); this.host = false; this.code = '';
  }
}

function errMsg(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return '해당 코드의 방을 찾을 수 없어요.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return '매칭 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
    case 'browser-incompatible': return '이 브라우저는 온라인 플레이를 지원하지 않아요.';
    default: return '연결 오류가 발생했어요. (' + ((err && err.type) || '알 수 없음') + ')';
  }
}
