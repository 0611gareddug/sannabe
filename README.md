# NEON TETHER (네온 테더)

사슬 와이어로 비 내리는 네온 도시를 질주하는 **멀티플레이 와이어 액션 게임**이에요.
세계관, 캐릭터, 레벨, 그래픽, 사운드는 모두 이 프로젝트를 위해 새로 만들었어요. 그래픽은 코드로 그린 벡터이고, 사운드는 WebAudio로 합성해요.

- **모드**: 훈련(튜토리얼) · 협동 스테이지 5개 + 보스전 · 레이스 코스 3개(고스트 기록)
- **온라인**: 방 코드로 최대 4인 P2P(WebRTC). 닉네임·색상 선택과 채팅을 지원해요.
- **액션**: 스윙 + 당기기 와이어, 적 낚아채기 돌진, 대시(무적), 벽 점프, 슬로모션
- **기기**: PC(키보드/마우스), 모바일(조이스틱 + 버튼 + 자동 조준, 전체화면), 게임패드

## 폴더 구조

```
sannabe/
├─ src/              ← 원본 소스 (수정은 여기서)
│  ├─ index.html
│  ├─ style.css
│  └─ js/
│     ├─ main.js       진입점
│     ├─ game.js       게임 루프, 모드, 네트워크 동기화, HUD
│     ├─ player.js     플레이어 물리 (와이어/대시/벽 점프)
│     ├─ enemies.js    적, 탄환, 레이저, 보스 AI
│     ├─ levels.js     스테이지/코스 설계 (구간 템플릿)
│     ├─ world.js      타일 충돌, 레이캐스트
│     ├─ render.js     네온 렌더러 (청크 캐시)
│     ├─ fx.js         파티클, 흔들림, 슬로모션
│     ├─ audio.js      합성 효과음 + BGM
│     ├─ input.js      키보드/마우스/터치/게임패드
│     ├─ net.js        PeerJS P2P
│     ├─ ui.js         메뉴, 로비, 결과, 채팅
│     ├─ protect.js    우클릭·개발자도구 단축키 차단
│     ├─ config.js / util.js
├─ docs/             ← 배포용 빌드 결과 (번들 + 난독화). GitHub Pages가 이 폴더를 서비스해요
├─ build.mjs         빌드 스크립트
└─ package.json
```

## 빌드

```bash
npm install
npm run build      # src → docs (난독화 적용, 배포용)
npm run dev        # src → dev  (난독화 없음, 테스트용)
```

수정 후에는 `npm run build`를 다시 실행하고 `docs/`까지 함께 커밋하세요.

## GitHub Pages 배포

1. 저장소 **Settings → Pages**로 이동해요.
2. **Source**: `Deploy from a branch`, **Branch**: `main` / `/docs`를 선택하고 저장해요.
3. 1~2분 뒤 https://0611gareddug.github.io/sannabe/ 에서 접속할 수 있어요.

## 참고

- 온라인 매칭은 PeerJS 공개 시그널링 서버(0.peerjs.com)를 사용하고, 연결된 뒤에는 브라우저끼리 직접 통신해요. 일부 회사·학교 네트워크나 대칭형 NAT 환경에서는 연결이 실패할 수 있어요. 그런 경우에는 TURN 서버를 `src/js/net.js`의 `iceServers`에 추가하면 돼요.
- 공개 저장소라면 `src/` 원본도 공개돼요. 원본을 숨기려면 저장소를 비공개로 하고(비공개 저장소의 Pages는 유료 플랜이 필요) 원본은 별도로 보관하세요.
