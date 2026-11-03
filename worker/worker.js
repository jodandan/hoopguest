// 훕게스트(hoopguest) — 알림 서버 (Cloudflare Workers 무료 플랜)
// - POST /subscribe, /unsubscribe : 웹 푸시 구독 저장/삭제 (알림 주소 + 조건만 저장)
// - GET  /vapid                   : 푸시 공개키 (최초 요청 때 자동 생성해 KV에 보관)
// - POST /sub-state               : 구독 주소로 지금 알림 조건(조건·이름·링크) 조회 — 서비스워커가 알림 만들 때 사용
// - POST /remind                  : 저장한 글 리마인더 목록 통째 교체 (시작 2시간 전 알림, 빈 배열이면 삭제)
// - cron(5분마다)                 : GitHub 수집 워크플로 실행 요청 (가장 중요 — 다른 단계와 따로 실행)
//                                   + 새 글(조건 맞는 구독) + 때가 된 저장 글 리마인더(조용한 시간에도) → 구독마다 푸시 1회
//                                   + 매시 D1 정리, 하루 1회 허용 목록 밖 구독 개수 로그(삭제 안 함)
// KV 키: 'sub:<h>' 구독 / 'seen' 지난 글 목록 / 'vapid' — 리마인더·횟수 제한·연속 실패는 D1 (remind.js)
// 바인딩: KV "SUBS", D1 "DB" / 시크릿: GH_TOKEN(선택, 워크플로 실행 권한)
import { handleAccount, linkDevice, ipKeys, dbInit, sweepAccounts } from './account.js'; // 카카오 로그인·기기 동기화 (/auth/kakao, /me, /logout)
import { replaceReminders, dueCandidates, claimDue, missingSubStmt, resetSentStmt, takeDue, dropStmts, runStmts, cleanupD1, drainKvDel, limitAll, acquireLease, releaseLeaseStmt, loadRR, saveRRStmt } from './remind.js'; // 저장 글 리마인더·횟수 제한(D1)
const SITE = 'https://hoopguest.kro.kr';
const REPO = 'jodandan/hoopguest';
const WORKFLOW = 'scrape.yml';
// 사이트 HTTPS 인증서 발급 전·장애 시에도 읽히도록 저장소 원본을 직접 읽는다
const DATA_URL = `https://raw.githubusercontent.com/${REPO}/main/docs/data.json`;
const ORIGINS = [SITE];

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);
async function sha(s) { return b64u(await crypto.subtle.digest('SHA-256', enc(s))).slice(0, 32); }

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : SITE,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

// ---- VAPID ----
// 서명 키는 바뀌면 모든 구독이 거절되므로 '정말 없을 때만' 만든다. 기준 저장소는 D1 meta('vapid') — 한 곳에서 순서대로 처리돼
// KV처럼 일시적으로 null이 읽히는 일이 없다. 운영 중인 기존 키(KV 'vapid')는 첫 실행 때 그대로 D1로 옮긴다(INSERT OR IGNORE).
// KV가 null이고 D1에도 없을 때도 KV 목록에 'vapid' 키가 보이면(읽기 지연) 만들지 않고 오류 → 다음 cron에 다시
const vapidCache = new WeakMap(); // DB 바인딩별
const okKey = v => !!v && typeof v === 'object' && typeof v.pub === 'string' && !!v.priv && typeof v.priv === 'object';
async function vapid(env) {
  if (vapidCache.has(env.DB)) return vapidCache.get(env.DB);
  try { return await vapidD1(env); }
  catch (e) { // D1 장애: KV에 있는 기존 키로만 동작(새로 만들지 않음, 캐시하지 않음)
    const kv = await env.SUBS.get('vapid', 'json').catch(() => null);
    if (okKey(kv)) return kv;
    throw e;
  }
}
async function vapidD1(env) {
  await dbInit(env);
  const fromD1 = async () => { const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'vapid'").first(); return r ? JSON.parse(r.v) : null; };
  let v = await fromD1();
  if (!okKey(v)) {
    let kv = await env.SUBS.get('vapid', 'json');
    if (!okKey(kv)) {
      // KV에서 null이어도 목록에 'vapid'가 보이면(지역 반영 지연 등) 새로 만들지 않음. 목록도 실패하면 만들지 않음(오류)
      const l = await env.SUBS.list({ prefix: 'vapid', limit: 10 });
      if (l.keys.some(k => k.name === 'vapid')) throw new Error('vapid: KV에 키가 있는데 읽히지 않음 — 새로 만들지 않음');
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      kv = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    }
    await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(kv)).run();
    v = await fromD1(); // 동시에 만든 다른 요청이 먼저 넣었으면 그 값
    if (!okKey(v)) throw new Error('vapid: D1 저장 확인 실패');
    if (v.pub !== kv.pub || !(await env.SUBS.get('vapid'))) await env.SUBS.put('vapid', JSON.stringify(v)).catch(() => {}); // 백업용 사본
  }
  vapidCache.set(env.DB, v);
  return v;
}
// 무료 플랜 CPU 10ms(cron 포함, 네트워크 대기 제외): ECDSA 서명·키 가져오기가 가장 비싼 계산이라
// 서명 키는 인스턴스당 1번만 가져오고, JWT는 푸시 서비스(aud)별로 12시간짜리를 만들어 남은 시간 1시간 전까지 재사용
// → cron 한 번에 서명은 많아야 푸시 서비스 수(FCM·Mozilla·Apple·WNS)만큼. 애플도 'JWT를 1시간보다 자주 바꾸지 말 것'을 권함
let signKey = null; const jwtCache = new Map();
export async function vapidJwt(v, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const c = jwtCache.get(aud);
  if (c && c.pub === v.pub && c.exp * 1000 - now > 3600e3) return c.t;
  if (!signKey || signKey.pub !== v.pub) signKey = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc(JSON.stringify({ aud, exp, sub: SITE })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey.key, enc(`${head}.${body}`));
  const t = `${head}.${body}.${b64u(sig)}`;
  jwtCache.set(aud, { t, exp, pub: v.pub });
  return t;
}
// 내용 없는 푸시(tickle): 알림 내용은 기기의 서비스워커가 사이트 목록을 읽어 조건에 맞게 만든다
async function push(v, sub) {
  const jwt = await vapidJwt(v, sub.endpoint);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `vapid t=${jwt}, k=${v.pub}`, 'TTL': '21600', 'Urgency': 'high', 'Content-Length': '0' },
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  return r.status;
}

// ---- 조건 매칭 (사이트/서비스워커와 같은 규칙) ----
export function matches(f, p) {
  f = f && typeof f === 'object' ? f : {}; // 조건 없는 옛 기록이 cron 단계 전체를 멈추지 않게
  if (!p || p.closed) return false;
  if (f.boards?.length && !f.boards.includes(p.board || 'guest')) return false;
  if (f.regions?.length) { if (!f.regions.includes(p.region2 || '기타')) return false; }
  else if (f.r1 && f.r1 !== '전체' && (p.region1 || '기타') !== f.r1) return false;
  if (f.slots?.length && !f.slots.includes(p.slot) && !(p.amb && (f.slots.includes('오전') || f.slots.includes('저녁')))) return false;
  if ((f.week && f.week !== '전체') || f.days?.length) {
    if (!p.date) return false;
    const w = new Date(p.date + 'T00:00:00Z').getUTCDay();
    if (f.week && f.week !== '전체' && (f.week === '주말') !== (w === 0 || w === 6)) return false;
    if (f.days?.length && !f.days.includes(w)) return false; // 요일 지정(0=일 … 6=토)
  }
  return true;
}
function cleanFilters(f = {}) {
  const arr = (a, n = 40) => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.length <= 20).slice(0, n) : [];
  return {
    boards: arr(f.boards, 3), r1: typeof f.r1 === 'string' ? f.r1.slice(0, 10) : '전체',
    regions: arr(f.regions, 80), slots: arr(f.slots, 3), week: ['주말', '평일'].includes(f.week) ? f.week : '전체',
    days: Array.isArray(f.days) ? [...new Set(f.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [],
  };
}
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
// 계정 알림 조건이 바뀌면 그 계정에 묶인 기기 구독을 모두 같은 조건으로 (KV 쓰기 = 바뀐 기기 수)
// 값이 같은 기기는 쓰지 않고, 계정당 하루 KV 쓰기 40회·전체 150회까지 (넘으면 -1: 계정 조건 저장을 보류해 다음 PUT에서 재시도)
async function applyAlert(env, sids, alert, uid) {
  const next = { filters: cleanFilters(alert.filters), label: str(alert.label, 80), query: str(alert.query, 300) };
  const todo = [];
  for (const sid of sids.slice(0, 20)) {
    const v = await env.SUBS.get(sid, 'json');
    if (!v) continue; // 없거나 지역 반영 지연 — 연결은 건드리지 않음(끊긴 구독의 연결은 404·410 처리 때 정리)
    if (JSON.stringify({ filters: v.filters, label: v.label, query: v.query }) !== JSON.stringify(next)) todo.push([sid, v]);
  }
  if (!todo.length) return 0;
  // 계정당 하루 40회 + 전체 하루 300회(KV 쓰기 하루 1,000 보호). D1 오류면 막음
  // KV 쓰기 하루 1,000 예산 배분: 새 구독 400 + 조건 변경 200 + 계정 동기화 150 + seen 최대 204 = 954
  const rules = [{ k: 'alg', ms: 864e5, max: 150, cost: todo.length }];
  if (uid) rules.push({ k: 'al:' + uid, ms: 864e5, max: 40, cost: todo.length });
  if (await limitAll(env, rules).catch(() => true)) return -1; // 거절(호출 쪽이 계정 조건 저장을 보류)
  for (const [sid, v] of todo) await env.SUBS.put(sid, JSON.stringify({ ...v, ...next, at: Date.now() }));
  return todo.length;
}

// ---- 푸시 주소 검증 ----
// 새로 받는 구독(/subscribe·/remind)은 알려진 브라우저 푸시 서비스의 실제 주소 형식만 받는다 (호스트 + 경로)
//  - 크롬·엣지(크로미움)·웨일 등: https://fcm.googleapis.com/fcm/send/<토큰> 또는 /wp/<토큰> (크로미움 push_messaging_constants)
//  - 파이어폭스: https://updates.push.services.mozilla.com/wpush/v1|v2/<토큰>
//  - 사파리: https://web.push.apple.com/<토큰> — 애플은 서버 방화벽에 *.push.apple.com 허용을 안내 → 한 단계 하위 호스트도 받되
//           경로는 토큰 한 칸만(앱용 APNs의 /3/device/… 형식은 거부)
//  - 옛 엣지(WNS): https://<지역>.notify.windows.com/w/?token=<토큰>
// 브라우저가 만든 주소는 이미 정규화돼 있으므로 URL로 다시 써도 같은 문자열이어야 함(대문자 호스트·:443·\·# 등 거부)
const PUSH_RULES = [
  // FCM 토큰 문자: 영숫자·하이픈·밑줄·콜론. 모질라·애플 토큰: base64url(+ '=' 패딩). %·. 은 받지 않음(경로 조작 방지)
  { host: /^fcm\.googleapis\.com$/, path: /^\/(fcm\/send|wp)\/[A-Za-z0-9_:\-]+$/ },
  { host: /^(updates|[a-z0-9]([a-z0-9-]*[a-z0-9])?)\.push\.services\.mozilla\.com$/, path: /^\/wpush\/v[12]\/[A-Za-z0-9_=\-]+$/ },
  { host: /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)?push\.apple\.com$/, path: /^\/[A-Za-z0-9_=\-]+$/ },
  { host: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.notify\.windows\.com$/, path: /^\/w\/$/, query: /^\?token=[A-Za-z0-9%+/=_.\-]+$/ },
];
const parseHttps = ep => {
  if (typeof ep !== 'string' || ep.length > 1024 || !ep.startsWith('https://') || /[\s\\]/.test(ep)) return null;
  try { const u = new URL(ep); return u.protocol === 'https:' && !u.port && !u.username && !u.password ? u : null; } catch { return null; }
};
export function allowedEndpoint(ep) {
  const u = parseHttps(ep);
  if (!u || u.href !== ep || u.hash || /[#?]$/.test(ep) || ep.includes('#')) return false; // 끝이 빈 # · ? 도 거부
  const r = PUSH_RULES.find(x => x.host.test(u.hostname));
  return !!r && r.path.test(u.pathname) && (r.query ? r.query.test(u.search) : u.search === '');
}
// 이미 저장된 구독(cron·정리)은 호스트만 본다 — 경로 규칙을 몰라 정상 구독을 지우는 일이 없게
export function hostAllowed(ep) {
  const u = parseHttps(ep);
  return !!u && PUSH_RULES.some(x => x.host.test(u.hostname));
}
// p256dh = P-256 공개키 65바이트(base64url 87자), auth = 16바이트(22자)
const B64U = n => new RegExp(`^[A-Za-z0-9_-]{${n}}={0,2}$`);
export function validSubscription(sub) {
  return !!sub && typeof sub === 'object' && allowedEndpoint(sub.endpoint) && !!sub.keys && typeof sub.keys === 'object'
    && typeof sub.keys.p256dh === 'string' && B64U(87).test(sub.keys.p256dh) && sub.keys.p256dh.startsWith('B')
    && typeof sub.keys.auth === 'string' && B64U(22).test(sub.keys.auth);
}
// 사용자 해지(/unsubscribe) 때 구독·리마인더·계정 연결 삭제. D1을 먼저 지우고 KV를 지운다
// D1이 실패하면 KV도 지우지 않음 → 브라우저가 이미 구독을 끊었으므로 다음 발송 때 404·410을 받아 그 경로에서 다시 정리
async function dropSub(env, h) {
  try { await runStmts(env, dropStmts(env, h)); } catch (e) { console.log('unsubscribe d1', errMsg(e)); return false; }
  await env.SUBS.delete('sub:' + h);
  return true;
}

// ---- 알림 cron: 새 글 + 저장 글 리마인더를 합쳐 구독마다 cron당 푸시 1회 ----
// 무료 플랜 한 번 실행당 외부 요청 50개(data.json·GitHub dispatch 포함) → 푸시는 cron당 40개까지(PUSH_BUDGET)
//  1) 서명 키 확인 (없으면 아무 표시도 하지 않고 끝 → 리마인더 유실 없음)
//  2) 리마인더 먼저: 때가 된 구독을 예산 안에서 골라 그 구독만 '보냄' 표시
//  3) 새 글: 남은 예산으로 구독 해시 순서대로 돌고(라운드로빈), 못 보낸 구독은 커서·글 목록을 D1 meta에 남겨 다음 cron에 이어서
//  4) 발송: 2xx 성공 / 404·410만 삭제(푸시 서비스가 '없는 구독'이라고 확답) / 그 밖의 모든 실패는 아무것도 지우지 않음
//     (리마인더만 다음 cron에 한 번 재시도). 서버 쪽 공통 원인(키·설정)으로 전원이 403을 받아도 구독이 사라지지 않게
//  한 cron에서 구독 값(KV get)은 700개까지만 읽음(내부 요청 1,000 한도) — 넘으면 커서를 남기고 다음 cron
const PUSH_BUDGET = 40;
const FRESH_MS = 9 * 3600e3;     // 서비스워커가 새 글로 보는 기간과 같음
const RR_MAX_ROUNDS = 20;   // 넘으면 가장 오래된 두 라운드를 합침(누락 없음, 일부 구독 조용한 중복 가능)
const RR_MAX_POSTS = 60;    // 합친 라운드의 글 상한(오래된 글부터 뺌)
const KV_GET_BUDGET = 700;
const SKIP_MAX = 1500;      // 이미 받은 구독 기록 상한(넘치면 오래된 기록부터 버림 → 중복 가능, 누락 없음)
const SWEEP_SAMPLE = 300;
// 구독 키(해시)만 목록으로 — 값은 필요할 때만 get (KV 읽기 절약). 정렬해 라운드로빈 순서로 씀
async function listSubKeys(env) {
  const out = []; let cursor;
  do {
    const r = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of r.keys) out.push(k.name.slice(4));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort();
}
async function listSubs(env) {
  const out = []; let cursor;
  do {
    const r = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of r.keys) { const v = await env.SUBS.get(k.name, 'json'); if (v) out.push({ id: k.name, h: k.name.slice(4), ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
async function freshPosts(env, now) {
  const kh = new Date(now + 9 * 3600e3).getUTCHours();
  if (kh < 7) return { quiet: true, fresh: [] };
  const res = await fetch(`${DATA_URL}?t=${now}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return { error: `data.json ${res.status}`, fresh: [] };
  const d = await res.json();
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  const live = (d.posts || []).filter(p => p && p.key && !p.closed && (!p.date || p.date >= today));
  const old = (await env.SUBS.get('seen', 'json')) || [];
  const seen = new Set(old);
  const first = seen.size === 0;
  const fresh = first ? [] : live.filter(p => !seen.has(p.key) && now - Date.parse(p.posted) < FRESH_MS);
  const next = live.map(p => p.key).slice(0, 2000);
  const changed = next.length !== old.length || next.some(k => !seen.has(k)); // 순서만 바뀐 건 같은 것으로 봄
  return { fresh, first, next, changed, old, liveKeys: new Set(live.map(p => p.key)) };
}
const compact = p => ({ key: p.key, posted: p.posted, board: p.board, region1: p.region1, region2: p.region2, slot: p.slot, amb: p.amb, date: p.date });
const errMsg = e => String(e && e.message || e);
const stop2 = st => st.some(x => x.__rewind);
export async function runNotify(env, now = Date.now()) {
  const out = { fresh: 0, remind: 0, sent: 0, removed: 0, failed: 0, transient: 0, deferred: 0, errors: [] };
  const err = (k, e) => out.errors.push(k + ': ' + errMsg(e));
  // 1) 서명 키
  let v; try { v = await vapid(env); } catch (e) { err('vapid', e); return out; }
  // 2) 새 글 확인 (아직 seen 저장 안 함)
  let f = { fresh: [] };
  try { f = await freshPosts(env, now); } catch (e) { err('new', e); }
  if (f.quiet) out.quiet = true; if (f.error) out.errors.push(f.error); if (f.first) out.first = true;
  out.fresh = f.fresh.length;
  let rr = null, rrLoaded = false;
  if (!f.quiet) { try { rr = await loadRR(env); rrLoaded = true; } catch (e) { err('rr', e); } }
  rr = rr || { g: '', rounds: [] };
  if (typeof rr.g !== 'string') rr.g = '';
  if (!Array.isArray(rr.rounds)) rr.rounds = [];
  if (!Number.isInteger(rr.seq)) rr.seq = 0;
  if (!rr.skip || typeof rr.skip !== 'object' || Array.isArray(rr.skip)) rr.skip = {};
  rr.rounds = rr.rounds.filter(r => r && typeof r === 'object');
  rr.rounds.forEach(r => { delete r.skip; if (!Number.isInteger(r.id)) r.id = ++rr.seq; }); // 옛 형식 호환
  const rrBefore = JSON.stringify(rr);
  // 새 글 알림은 이번 data.json을 읽었을 때만(이어 보내는 라운드도 지금 살아 있는 글로 다시 거르므로 — 못 읽으면 다음 cron에)
  let wantNew = !f.quiet && !!f.liveKeys && (f.fresh.length > 0 || rr.rounds.length > 0);
  let subs = null;
  if (wantNew) { try { subs = await listSubKeys(env); } catch (e) { err('list', e); wantNew = false; } } // 해시 목록(값은 아래에서 필요한 만큼만)
  // 새 글을 보낼 때는 항상 4분 lease — 겹친 cron이 같은 새 글을 두 번 보내지 않게 (D1 쓰기: 새 글 있는 cron마다 획득 1행 + 해제 1행)
  let lease = null;
  if (wantNew) {
    lease = await acquireLease(env, Date.now()).catch(e => { err('lease', e); return 'open'; }); // 만료는 실제 시각 기준(늦게 시작한 cron도 겹침 방지)
    if (!lease) { wantNew = false; out.lease = 'busy'; }
  }
  // seen 저장 (KV 쓰기는 cron당 많아야 1번):
  //  - 새 글이 없으면(목록만 바뀜) 지금 저장
  //  - 새 글이 있는데 이번에 처리 못 하면(lease·목록 실패) 저장하지 않음 → 다음 cron에 다시 새 글로 잡힘
  //  - 새 글 라운드를 만들면 rr 저장이 성공한 뒤에 저장(아래 5) 직전). rr 저장이 실패하면 seen도 저장하지 않음 → 다음 cron에 다시
  //    이미 라운드에 들어 있는 글은 새 라운드에 다시 넣지 않음(seen 저장 실패 뒤 같은 글이 또 새 글로 잡혀도 중복 없음)
  let seenLater = false;
  if (!f.quiet && f.changed && !f.fresh.length) {
    try { await env.SUBS.put('seen', JSON.stringify(f.next)); } catch (e) { err('seen put', e); }
  }
  let addedRound = false, rrFailed = false;
  if (wantNew && f.fresh.length) {
    const inRound = new Set(rr.rounds.flatMap(r => Array.isArray(r.posts) ? r.posts.map(p => p.key) : []));
    const posts = f.fresh.filter(p => !inRound.has(p.key)).slice(0, 30).map(compact);
    if (posts.length) { rr.rounds.push({ id: ++rr.seq, start: rr.g, wrapped: false, posts }); addedRound = true; }
    seenLater = f.changed;
  }
  const subCache = new Map(); // 이번 cron에서 읽은 구독 값 (h → 값 | null)
  let gets = 0;
  const getSub = async h => { gets++; const v = await env.SUBS.get('sub:' + h, 'json'); subCache.set(h, v); return v; };
  const targets = new Map(); // h → { sub, rem: bool, isNew: bool }
  const st = []; // 끝에 한꺼번에 실행할 D1 문장
  // 3) 리마인더 (예산 안에서 먼저)
  try {
    const cands = await dueCandidates(env, now, PUSH_BUDGET);
    const pick = [];
    for (const h of cands) {
      let rec;
      try { rec = await getSub(h); } catch (e) { err('remind get', e); continue; } // 오류면 그대로 두고 다음 cron
      if (rec === null) { st.push(missingSubStmt(env, h, now)); continue; } // 확실히 없음: 리마인더만 한 번 미루고 다음엔 포기(구독·계정 연결은 건드리지 않음)
      if (!hostAllowed(rec.sub && rec.sub.endpoint)) { st.push(missingSubStmt(env, h, now)); continue; } // 보내지 않음(구독 정리는 하루 1회 작업)
      pick.push([h, rec]);
    }
    const claimed = await claimDue(env, pick.map(x => x[0]), now);
    const got = new Set(claimed.map(r => r.sh));
    out.remind = got.size; out.remindRows = claimed.length; // 리마인더 받을 구독 수 · 글 수
    for (const [h, rec] of pick) if (got.has(h)) targets.set(h, { sub: rec.sub, rem: true, isNew: false });
  } catch (e) { err('remind', e); }
  // 4) 새 글 — 남은 예산으로 라운드로빈
  let allRounds = null;
  if (wantNew && subs) {
    let budget = PUSH_BUDGET - targets.size;
    // 9시간 지난 글·마감됐거나 이번 data.json에 없는 글은 글 단위로 뺌 → 빈 라운드는 대상에서 제외(헛알림 방지)
    const live = p => now - Date.parse(p.posted) < FRESH_MS && f.liveKeys.has(p.key);
    let rounds = rr.rounds.filter(r => Array.isArray(r.posts) && r.posts.some(live));
    rounds.forEach(r => { r.posts = r.posts.filter(live); });
    // 라운드가 너무 많으면 가장 오래된 라운드를 다음 라운드에 합침: 뒤 라운드의 남은 범위가 앞 라운드의 남은 범위를 포함하므로
    // 아직 못 받은 구독은 모두 그대로 받음(누락 없음). 앞 라운드를 이미 받은 구독 중 앞 라운드 글만 맞는 구독은 한 번 더 받을 수 있음
    while (rounds.length > RR_MAX_ROUNDS) {
      const [a, b] = rounds; const keys = new Set(b.posts.map(p => p.key));
      b.posts = [...a.posts.filter(p => !keys.has(p.key)), ...b.posts].slice(-RR_MAX_POSTS);
      rounds.shift();
    }
    const skipped = (h, r) => (rr.skip[h.slice(0, 10)] || 0) >= r.id; // 이 구독이 r 라운드가 생긴 뒤 푸시를 받았음
    const H = subs; // 해시 순
    // 라운드 = 한 번의 새 글 묶음. start(그때 커서) 다음 구독부터 한 바퀴 돌아 start까지 오면 끝
    // 구독 해시 순서로 돌기 때문에 사이에 새로 생긴 구독도 해시 위치에 따라 자연스럽게 포함/제외된다
    let g = rr.g, next = null; // next: 이번에 처리하지 못한 첫 구독(없으면 한 바퀴 끝)
    if (H.length && rounds.length) {
      let i = H.findIndex(h => h > g);
      const wrap = () => rounds.forEach(r => { if (r.wrapped) r.done = true; else r.wrapped = true; }); // 두 번째 경계 통과 = 한 바퀴 끝
      if (i < 0) { i = 0; rounds.forEach(r => { r.wrapped = true; }); } // 지난 cron 끝에서 이미 센 경계일 수 있어 끝내지 않음
      for (let step = 0; step < H.length; step++) {
        const idx = (i + step) % H.length;
        if (step > 0 && idx === 0) wrap();
        const h = H[idx];
        const act = rounds.filter(r => !r.done && !(r.wrapped && h > r.start) && !skipped(h, r));
        if (!rounds.some(r => !r.done && !(r.wrapped && h > r.start))) break; // 모든 라운드 끝
        let s = subCache.get(h);
        if (s === undefined) {
          if (gets >= KV_GET_BUDGET) { next = h; break; } // 읽기 예산 소진 — 이 구독부터 다음 cron
          try { s = await getSub(h); } catch (e) { err('get', e); next = h; break; } // 오류면 멈추고 다음 cron에 이 구독부터
        }
        if (s && hostAllowed(s.sub && s.sub.endpoint) && act.some(r => r.posts.some(p => live(p) && matches(s.filters, p)))) {
          const t = targets.get(h);
          if (t) t.isNew = true;
          else if (budget > 0) { targets.set(h, { sub: s.sub, rem: false, isNew: true, prevG: g, snap: rounds.map(r => r.wrapped) }); budget--; }
          else { next = h; break; } // 예산 소진 — 이 구독부터 다음 cron
        }
        g = h;
      }
    }
    allRounds = rounds;
    rr.g = g;
    // 끝난 라운드: 한 바퀴 돌았고, 다음에 볼 구독이 없거나 start 뒤쪽
    rr.rounds = next == null ? [] : rounds.filter(r => !r.done && !(r.wrapped && next > r.start));
    out.deferred = rr.rounds.length;
  }
  // 커서·남은 글은 푸시 전에 저장 (중간에 멈춰도 이어서). D1 장애면 남은 대상은 이번 cron 것으로 끝
  if (!rr.rounds.length) { rr.g = ''; rr.skip = {}; rr.seq = 0; } // 다 보냈으면 커서 기록 불필요(다음 새 글은 처음부터) → 평소 D1 쓰기 0
  let rrSaved = false;
  if (rrLoaded && JSON.stringify(rr) !== rrBefore) {
    try { await saveRRStmt(env, rr).run(); rrSaved = true; }
    catch (e) {
      // 커서·라운드를 못 남기면 이번 새 글 발송을 멈춤(리마인더만) — 남은 구독이 영영 못 받거나, 다음 cron에 같은 구독에 또 가는 것 방지
      err('rr save', e);
      for (const [h, t] of [...targets]) { if (t.rem) t.isNew = false; else targets.delete(h); }
      out.deferred = 0;
      rrFailed = true; // seen은 저장하지 않음 → 다음 cron에 같은 글을 새 글로 다시 잡음 (KV 되돌림 쓰기 없음)
    }
  }
  if (seenLater && !rrFailed) {
    try { await env.SUBS.put('seen', JSON.stringify(f.next)); }
    catch (e) {
      err('seen put', e);
      // 라운드가 rr에 저장됐으면 그대로 보냄(다음 cron에 같은 글이 또 잡혀도 라운드에 있으니 다시 넣지 않음).
      // rr 저장이 없었으면(한 cron에 다 보내는 경우) 이번 새 글 발송을 미룸 → 다음 cron에 한 번만
      if (!rrSaved) for (const [h, t] of [...targets]) { if (t.rem) t.isNew = false; else targets.delete(h); }
    }
  }
  // 5) 발송
  const gone = []; // 404·410 → D1 정리가 성공한 뒤에 KV 삭제(실패하면 KV가 남아 다음 발송 때 다시 410 → 재시도)
  const okSent = [];
  if (targets.size) {
    let stop = false, rewound = false;
    for (const [h, t] of targets) {
      let code;
      if (!stop) {
        try { code = await push(v, t.sub); }
        catch (e) {
          if (/too many subrequests/i.test(errMsg(e))) { stop = true; err('push', e); } // 이 대상부터 아래 되감기로
          else code = 0; // 네트워크 예외·시간 초과
        }
      }
      if (stop) {
        if (t.rem) st.push(env.DB.prepare('UPDATE reminders SET sent_at = NULL WHERE sh = ? AND sent_at = ? AND dlv_at IS NULL').bind(h, now));
        // 못 보낸 첫 새 글 대상부터 다음 cron에 이어서 (커서·라운드를 그 시점으로 되돌림)
        if (!t.rem && t.prevG !== undefined && !rewound && allRounds && rrLoaded) {
          rewound = true;
          const rs = allRounds.map((r, i) => ({ ...r, wrapped: t.snap[i], done: false })).filter(r => !(r.wrapped && h > r.start));
          { const x = saveRRStmt(env, { ...rr, g: t.prevG, rounds: rs }); x.__rewind = true; st.push(x); } out.deferred = rs.length;
        }
        continue;
      }
      if (code >= 200 && code < 300) { out.sent++; okSent.push(h); continue; }
      if (code === 404 || code === 410) { gone.push(h); st.push(...dropStmts(env, h)); continue; }
      out.failed++; // 그 밖의 모든 실패(0·4xx·5xx): 지우지 않음. 리마인더는 한 번만 재시도
      if (t.rem) st.push(resetSentStmt(env, h, now));
    }
  }
  // L-1: 이번에 푸시를 받은 구독은 지금 있는 새 글을 이미 기기에서 다 봤다 → 아직 그 구독까지 안 간 라운드에서 건너뜀
  // (라운드가 남아 있을 때만, 같은 meta 행을 한 번 더 쓰는 정도)
  //  기록은 rr 전체에 하나: { 구독 해시 앞 10자: 그때 가장 최근 라운드 id } (라운드마다 따로 두지 않아 행 크기가 구독 수에 비례)
  if (rrLoaded && !rrFailed && !stop2(st) && rr.rounds.length && okSent.length) {
    const top = Math.max(...rr.rounds.map(r => r.id)), min = Math.min(...rr.rounds.map(r => r.id));
    for (const h of okSent) rr.skip[h.slice(0, 10)] = top;
    let ent = Object.entries(rr.skip).filter(([, v]) => v >= min); // 끝난 라운드 기록은 버림
    if (ent.length > SKIP_MAX) ent = ent.sort((x, y) => y[1] - x[1]).slice(0, SKIP_MAX);
    rr.skip = Object.fromEntries(ent);
    st.push(saveRRStmt(env, rr));
  }
  if (lease && lease !== 'open') st.push(releaseLeaseStmt(env, lease));
  let d1ok = true;
  if (st.length) { try { await runStmts(env, st); } catch (e) { d1ok = false; err('d1 write', e); } }
  if (d1ok) for (const h of gone) { try { await env.SUBS.delete('sub:' + h); out.removed++; } catch (e) { err('drop kv', e); } }
  return out;
}
export const checkAndPush = runNotify; // 이전 이름 호환

// 하루 1회(KST 04:30): 허용 호스트 밖 구독 개수만 로그 (자동 삭제하지 않음 — 이런 구독은 발송 대상에서 이미 빠짐)
// 내부 요청(1,000) 한도를 알림 cron과 나눠 쓰므로 값은 300개 표본만 읽음(전체 키 목록에서 고르게)
export async function sweepSubs(env) {
  const keys = await listSubKeys(env);
  const step = Math.max(1, Math.ceil(keys.length / SWEEP_SAMPLE));
  let n = 0, seen = 0;
  for (let i = 0; i < keys.length && seen < SWEEP_SAMPLE; i += step) {
    const v = await env.SUBS.get('sub:' + keys[i], 'json'); seen++;
    const ep = v && v.sub && v.sub.endpoint;
    if (typeof ep === 'string' && !hostAllowed(ep)) n++;
  }
  return { total: keys.length, sampled: seen, outsideAllowList: n, estimate: seen ? Math.round(n * keys.length / seen) : 0 };
}

// 이전 배포(origin 보안 커밋)가 쓰던 KV 'queue'(새 글 알림 대기 구독 id) — 이 버전은 D1 rr로 이어 보내므로 쓰지 않는다.
// 남아 있으면 매시 정리 때 지움(값을 읽어 개수만 로그). 그 안의 대기분은 배포 직전 몇 cron의 새 글 알림 일부라 버림(재발송하면 중복 위험)
async function dropLegacyQueue(env) {
  const q = await env.SUBS.get('queue', 'json').catch(() => null);
  if (q == null) return { queue: 'none' };
  await env.SUBS.delete('queue');
  return { queueDropped: Array.isArray(q) ? q.length : 0 };
}

async function handleRemind(req, env) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > 32768) return json(req, { error: 'too large' }, 400);
  const text = await req.text();
  if (enc(text).length > 32768) return json(req, { error: 'too large' }, 400); // 바이트 기준
  let body; try { body = JSON.parse(text); } catch { return json(req, { error: 'bad request' }, 400); }
  const { endpoint, items } = body || {};
  if (!allowedEndpoint(endpoint) || !Array.isArray(items)) return json(req, { error: 'bad request' }, 400);
  if (items.length > 50) return json(req, { error: 'too many items' }, 400);
  const h = await sha(endpoint);
  if (!(await env.SUBS.get('sub:' + h))) return json(req, { error: 'not found' }, 404);
  const ip = await ipKeys(req, env).catch(() => null);
  const r = await replaceReminders(env, h, items, ip);
  if (r.error) return json(req, r.status === 429 ? { error: r.error, code: 'rate' } : { error: r.error }, r.status);
  return json(req, { ok: true, n: r.n }); // 빈 배열이면 그 구독의 리마인더 삭제, n: 0
}

async function dispatchScrape(env) {
  if (!env.GH_TOKEN) return 'no token';
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.GH_TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'bdrguest-worker', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  return r.status;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    try {
      if (url.pathname === '/vapid' && req.method === 'GET') return json(req, { key: (await vapid(env)).pub });
      if (url.pathname === '/subscribe' && req.method === 'POST') {
        const text = await req.text();
        if (text.length > 16000) return json(req, { error: 'bad request' }, 400);
        let body; try { body = JSON.parse(text); } catch { return json(req, { error: 'bad request' }, 400); }
        const sub = body && body.subscription;
        // 크기 기준은 예전과 같게(글자 수 4000) — 한글 조건이 많은 기존 클라이언트 회귀 방지
        if (!validSubscription(sub) || JSON.stringify(body).length > 4000) return json(req, { error: 'bad request' }, 400);
        const id = 'sub:' + await sha(sub.endpoint);
        const rec = { sub: { endpoint: sub.endpoint }, filters: cleanFilters(body.filters), label: str(body.label, 80), query: str(body.query, 300) };
        const old = await env.SUBS.get(id, 'json');
        // 같은 구독·같은 조건이면 KV에 다시 쓰지 않음 (기기 연결만 갱신)
        if (!old || JSON.stringify({ sub: old.sub, filters: old.filters, label: old.label, query: old.query }) !== JSON.stringify(rec)) {
          // KV 쓰기 한도(하루 1,000) 보호 — 규칙을 전부 통과할 때만 기록(거절은 D1 쓰기 0)
          //  접속지(IPv4 /32·IPv6 /64) 1시간 40회·하루 60회, IPv6 /48 1시간 60회
          //  전체: 새 구독 하루 400회, 기존 구독 조건 변경 하루 200회(서로 따로 → 가짜 새 구독 폭주가 기존 사용자 변경을 막지 않음)
          //  seen(하루 ~100)·계정 동기화 몫을 남겨, KV 쓰기 소진으로 서비스 전체 알림이 멈추는 것을 막는 마지막 안전장치
          //  D1(횟수 기록)이 안 되면 KV를 보호할 수 없으므로 거절(닫힘) — 알림 켜기만 잠시 실패, 기존 알림 발송은 영향 없음
          const now = Date.now();
          const over = await (async () => {
            const ip = await ipKeys(req, env);
            const rules = [{ k: 's:' + ip.ih, ms: 3600e3, max: 40, cost: 1 }, { k: 'sd:' + ip.ih, ms: 864e5, max: 60, cost: 1 },
              old ? { k: 'sgc', ms: 864e5, max: 200, cost: 1 } : { k: 'sg', ms: 864e5, max: 400, cost: 1 }];
            if (ip.ih48) rules.push({ k: 's48:' + ip.ih48, ms: 3600e3, max: 60, cost: 1 }, { k: 's48d:' + ip.ih48, ms: 864e5, max: 150, cost: 1 }); // /48 하루 150(전체 400을 혼자 못 채움)
            return limitAll(env, rules, now);
          })().catch(e => { console.log('subscribe limit', errMsg(e)); return 'down'; });
          if (over === 'down') return json(req, { error: 'try later' }, 503);
          if (over) return json(req, { error: 'too many', code: 'rate' }, 429);
          await env.SUBS.put(id, JSON.stringify({ ...rec, at: now }));
        }
        const linked = await linkDevice(req, env, id).catch(() => null); // 로그인 중이면 계정에 묶음
        return json(req, { ok: true, linked: !!linked });
      }
      if (url.pathname === '/unsubscribe' && req.method === 'POST') {
        const { endpoint } = (await req.json().catch(() => null)) || {};
        if (typeof endpoint === 'string' && endpoint.length <= 1024) {
          const h = await sha(endpoint);
          // 등록된 구독일 때만 정리 (없는 주소는 읽기 1회로 끝). D1 정리 실패면 503 — KV도 그대로 두어 다시 시도할 수 있게
          if (await env.SUBS.get('sub:' + h) && !(await dropSub(env, h))) return json(req, { error: 'try later' }, 503);
        }
        return json(req, { ok: true });
      }
      if (url.pathname === '/sub-state' && req.method === 'POST') {
        const { endpoint } = (await req.json().catch(() => null)) || {};
        const h = typeof endpoint === 'string' && hostAllowed(endpoint) ? await sha(endpoint) : null; // 푸시 서비스 주소만
        const v = h ? await env.SUBS.get('sub:' + h, 'json') : null;
        if (!v) return json(req, { error: 'not found' }, 404);
        // due: 서버가 15분 안에 리마인더 푸시를 보낸 글(넘기며 전달 표시). 조회 실패면 null → 서비스워커가 빈 '새 글' 알림을 띄우지 않음
        // late: 보낸 지 15분~6시간 지났는데 아직 안 뜬 글(소비 안 함, 기기에서 한 번만) / rp: 15분 안에 리마인더 푸시를 보냈음
        let r = { due: null, late: [], rp: false };
        try { r = await takeDue(env, h); } catch (e) { console.log('sub-state due', String(e && e.message || e)); }
        return json(req, { filters: v.filters || {}, label: v.label || '', query: v.query || '', due: r.due, late: r.late, rp: r.rp });
      }
      if (url.pathname === '/remind' && req.method === 'POST') return handleRemind(req, env);
      const acc = await handleAccount(req, env, url, json, { onAlert: (sids, alert, uid) => applyAlert(env, sids, alert, uid), drainKvDel: max => drainKvDel(env, max) });
      if (acc) return acc;
      if (url.pathname === '/health') return json(req, { ok: true });
      return json(req, { error: 'not found' }, 404);
    } catch (e) { return json(req, { error: 'server error' }, 500); }
  },
  async scheduled(event, env, ctx) {
    const now = event.scheduledTime || Date.now();
    const min = new Date(now).getUTCMinutes(), kh = new Date(now + 9 * 3600e3).getUTCHours();
    const log = (k, p) => p.then(r => console.log(k, JSON.stringify(r)), e => console.log(k, 'error', String(e && e.message || e)));
    // 단계마다 따로 실행 — 하나가 실패해도 나머지(특히 수집 실행 요청)는 그대로
    ctx.waitUntil(Promise.allSettled([
      log('dispatch', Promise.resolve().then(() => dispatchScrape(env))),
      log('notify', Promise.resolve().then(() => runNotify(env, now))),
      min < 5 ? log('cleanup', Promise.resolve().then(() => cleanupD1(env, now))) : null, // 매시 정각 1회
      min < 5 ? log('accounts', Promise.resolve().then(() => sweepAccounts(env))) : null, // 매시 1회 계정 표 정리(로그인 시작·만료 세션·끊긴 연결·오래된 문의)
      min < 5 ? log('legacy', Promise.resolve().then(() => dropLegacyQueue(env))) : null, // 이전 배포의 KV 'queue' 정리(한 번)
      min >= 30 && min < 35 && kh === 4 ? log('sweep', Promise.resolve().then(() => sweepSubs(env))) : null, // 하루 1회(KST 04:30, 정리와 다른 실행)
    ].filter(Boolean)));
  },
};
