# 훕게스트 — Claude 작업 규칙

모든 응답·보고·커밋 메시지는 한국어로 쓴다.

## 구조
- `scraper/scrape.mjs` 수집 → `docs/data.json` / `parser.mjs` 제목 → 지역·날짜·시간 / `places.mjs` 카카오 장소 확인 / `pages.mjs` 지역·체육관·공유·가이드 페이지·사이트맵·RSS 생성 / `indexnow.mjs` 색인 알림
- `worker/` Cloudflare Worker(알림·카카오 로그인·문의) / `.github/workflows/scrape.yml` 30분마다 수집
- `docs/index.html` 첫 화면 겸 마이페이지(`/my/`) / `DESIGN.md` 디자인 규칙 / `SPEC.md` 기능 명세

## 반드시 지킬 것
- `placeOf`는 `docs/index.html`과 `scraper/pages.mjs` 두 곳에 같은 코드가 있다. 고치면 둘 다 고친다.
- `docs/index.html`의 `<!--ssr-->`~`<!--/ssr-->` 사이는 수집 봇이 덮어쓴다. 손대지 않는다.
- 수집 때 생성되는 것은 직접 고치지 않는다: `docs/data.json`, `docs/places.json`, `docs/r/`, `docs/p/`, `docs/g/`, `docs/my/index.html`, `docs/sitemap.xml`, `docs/rss.xml`, `data/`. 고칠 땐 생성 코드(`pages.mjs` 등)를 고친다.
- 삭제 금지: `docs/CNAME`, `docs/googlecb623fa08c886315.html`, `docs/bddf8836eb999e8a6435b6d7f52cc56e.txt`
- 사이트 안 경로는 절대경로(`/data.json`)로 쓴다.
- 카카오 API 결과는 장소 ID만 저장한다(이름·주소·좌표 저장 금지).
- 실명·이메일 아이디를 코드·문서·커밋에 넣지 않는다. 운영자 표기는 "운영자".
- `docs/guide/index.html`을 고치면 `pages.mjs`의 `GUIDE_UPDATED`도 바꾼다.
- 화면을 바꾸면 320·360·390px·가로·PC × 밝게/어둡게에서 넘침을 확인한다. 폭 점검은 Black Han Sans가 실제로 로드된 상태에서 한다.

## 토큰 절약 (모든 세션·팀원 공통)
- 큰 파일은 통째로 읽지 않는다. `docs/index.html`(약 170KB), `scraper/pages.mjs`(50KB), `docs/data.json`, `data/history.json`은 Grep으로 위치를 찾고 필요한 줄만 offset·limit으로 읽는다. JSON은 `node -e`로 필요한 값만 뽑는다.
- `docs/p/`(공유 페이지 수백 개)는 읽지 않는다. 확인이 필요하면 1개만 본다.
- 이미 읽은 파일을 다시 통째로 읽지 않는다.
- 보고는 5줄 이내: 바꾼 파일 / 확인한 것 / 남은 문제 / 다른 담당에게 넘길 것.

## 팀 운영 (Agent Teams를 켠 세션에서만)
- 평소엔 혼자 작업하거나 하위 에이전트를 쓴다. 팀은 서로 의견을 맞춰야 하는 큰 작업에만 쓴다.
- 팀원은 최대 3명. `.claude/agents/`의 역할(backend·frontend·seo·qa)로 띄운다.
- 리드만 Opus, 팀원은 각 역할 파일의 모델(Sonnet·Haiku)을 쓴다.
- 파일 담당: 다른 담당 파일을 고쳐야 하면 직접 고치지 말고 담당에게 메시지로 바꿀 내용을 보낸다.

| 담당 | 파일 |
|---|---|
| backend | `scraper/`(pages.mjs 제외), `worker/`, `.github/`, `data/` |
| frontend | `docs/index.html`, `docs/sw.js`, `docs/404.html`, `docs/privacy/`, `docs/manifest.webmanifest`, `DESIGN.md` |
| seo | `scraper/pages.mjs`, `docs/guide/`, `docs/robots.txt` |
| qa | 고치지 않음(읽기·실행만) |

- 커밋·푸시는 리드만 한다. QA 통과 → 사용자 승인 → 커밋 순서.
- 일이 끝난 팀원은 바로 종료한다.
