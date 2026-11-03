// 훕게스트 계정(카카오 로그인, 선택) — 저장한 글·설정·알림 조건을 기기끼리 동기화
// - GET  /auth/kakao?mode=login|withdraw&n=…&return=… : 카카오 로그인 화면으로 보냄 (n: 로그인을 시작한 브라우저의 일회용 값)
// - GET  /auth/kakao/callback                     : 로그인 완료 → 사이트로 돌아가며 #login=<토큰>&n=<값> 전달 (브라우저는 n이 맞을 때만 받음)
//                                                   (탈퇴 모드면 카카오 연결 끊기 + 데이터 삭제 → #withdrawn=1)
// - GET  /me · PUT /me                             : 내 데이터 읽기·저장 (Authorization: Bearer <토큰>)
// - POST /logout                                   : 이 기기 로그인 토큰 삭제
// 맞춤 알림: 로그인한 채 알림을 켠 기기는 devices(sid → uid)로 계정에 묶이고, 계정의 알림 조건(data.alert)이 바뀌면
//           worker.js가 넘겨준 onAlert로 묶인 기기 구독 조건을 모두 바꾼다
// 저장소: D1 "DB" — users(uid, data, updated, created) · sessions(th, uid, created) · logins(state, ret, mode, n, uid, created) · devices(sid, uid, th, created) · meta(k, v)
//        + 알림용(remind.js): reminders · rl(횟수 제한) · kvdel(탈퇴 기기 구독 삭제 대기열) · meta의 'vapid'(서명 키)·'lease'(cron 겹침 방지)·'rr'(새 글 알림 이어 보내기)
// 개인정보: 카카오에서 받는 건 회원번호뿐. 서버엔 '비밀 소금 + 회원번호'의 SHA-256 값(uid)만 저장하고,
//           회원번호 원문·이름·이메일·카카오 토큰은 저장하지 않는다. 로그인 토큰도 해시로만 보관.
// 시크릿: KAKAO_REST_KEY(로그인에 쓸 REST API 키) / 선택: KAKAO_CLIENT_SECRET(카카오 콘솔에서 켰을 때만)
import { limitAll } from './remind.js'; // 횟수 제한(D1 rl, 원자적)
const SITE = 'https://hoopguest.kro.kr';
const ADMIN_UID = 'FfLxir2WfmLQg7tgKd_4mBMDRwyFPbWUFXuqOwei8E8'; // 운영자 계정 식별자(해시값) — 문의함을 볼 수 있는 계정
const RETURN_PATHS = ['/', '/my/']; // 로그인 후 돌아갈 수 있는 곳 — 이 사이트의 첫 화면·마이페이지만 (토큰이 다른 페이지·도메인으로 새지 않게)
const SESSION_MS = 180 * 864e5, STATE_MS = 10 * 60e3, MAX_DATA = 32000, MAX_RET_QS = 300;
const MAX_DEVICES = 20, CONTACT_DONE_MS = 180 * 864e5, CONTACT_MAX_MS = 365 * 864e5; // 계정당 연결 기기 수 / 문의 보관: 처리 후 6개월, 처리 안 해도 1년

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

let ready = null;
// 첫 요청 때 테이블 자동 생성 (worker.js·remind.js도 이 함수를 씀)
export function dbInit(env) { return init(env); }
function init(env) {
  if (!ready) ready = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS logins (state TEXT PRIMARY KEY, ret TEXT NOT NULL, mode TEXT NOT NULL, created INTEGER NOT NULL, n TEXT NOT NULL DEFAULT '', uid TEXT NOT NULL DEFAULT '')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS devices (sid TEXT PRIMARY KEY, uid TEXT NOT NULL, th TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL, reply TEXT NOT NULL, page TEXT NOT NULL, ih TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS contacts_ih ON contacts (ih, created)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS devices_uid ON devices (uid)'),
    // 저장 글 리마인더 (sh = 구독 해시, 시각은 ms). 부분 인덱스라 cron은 아직 안 보낸 행만 훑는다
    env.DB.prepare('CREATE TABLE IF NOT EXISTS reminders (sh TEXT NOT NULL, k TEXT NOT NULL, title TEXT NOT NULL, start_at INTEGER NOT NULL, due_at INTEGER NOT NULL, sent_at INTEGER, dlv_at INTEGER, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sh, k))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS reminders_due ON reminders (due_at) WHERE sent_at IS NULL AND dlv_at IS NULL'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS kvdel (sid TEXT PRIMARY KEY)'),
  ]).then(() => env.DB.prepare("ALTER TABLE logins ADD COLUMN n TEXT NOT NULL DEFAULT ''").run().catch(() => {})) // 예전 표에 n·uid 칸 추가(이미 있으면 무시)
    .then(() => env.DB.prepare("ALTER TABLE logins ADD COLUMN uid TEXT NOT NULL DEFAULT ''").run().catch(() => {}))
    .catch(e => { ready = null; throw e; });
  return ready;
}
let saltCache = null; // 소금은 바뀌지 않으므로 인스턴스당 1번만 읽음
export async function salt(env) {
  if (saltCache) return saltCache;
  let row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'salt'").first();
  if (!row) {
    await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', ?)").bind(rand(32)).run();
    row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'salt'").first();
  }
  return (saltCache = row.v);
}
// 접속지(IP) 해시 — 횟수 제한용. IP 원문은 저장하지 않음 (문의하기와 같은 방식)
// IPv6는 한 사용자(회선)가 /64 대역을 통째로 받는 경우가 많아 /64로 묶고, 더 큰 /48도 따로 셈. IPv4는 주소 그대로(/32)
export function ipPrefix(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip.includes(':')) return { p: ip || '-', p48: null };
  const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip); if (m) return { p: m[1], p48: null };
  const [a, b = null] = ip.split('::');
  const A = a ? a.split(':') : [], B = b == null ? [] : b ? b.split(':') : [];
  const full = b == null ? A : [...A, ...Array(Math.max(0, 8 - A.length - B.length)).fill('0'), ...B];
  const g = full.slice(0, 8).map(x => (parseInt(x, 16) || 0).toString(16));
  return { p: g.slice(0, 4).join(':') + '::/64', p48: g.slice(0, 3).join(':') + '::/48' };
}
export async function ipKeys(req, env) {
  await init(env);
  const { p, p48 } = ipPrefix(req.headers.get('CF-Connecting-IP'));
  const s = await salt(env);
  return { ih: await sha(p + ':' + s), ih48: p48 ? await sha(p48 + ':' + s) : null };
}
function safeReturn(r) {
  try { const u = new URL(r); if (u.origin === SITE && RETURN_PATHS.includes(u.pathname)) return SITE + u.pathname + (u.search.length <= MAX_RET_QS ? u.search : ''); } catch {}
  return SITE + '/';
}
const back = (ret, frag) => new Response(null, { status: 302, headers: { Location: `${ret}#${frag}`, 'Cache-Control': 'no-store' } });

async function who(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const row = await env.DB.prepare('SELECT uid, created FROM sessions WHERE th = ?').bind(await sha(m[1])).first();
  if (!row || Date.now() - row.created > SESSION_MS) return null;
  return { uid: row.uid, th: await sha(m[1]) };
}

// 알림 구독(sid = 'sub:…' KV 키)을 계정에 묶거나 푼다 — 로그인 토큰이 있으면 묶고, 없으면 풀기
export async function linkDevice(req, env, sid) {
  if (!env.DB) return null;
  await init(env);
  const u = await who(req, env);
  const cur = await env.DB.prepare('SELECT uid, th FROM devices WHERE sid = ?').bind(sid).first();
  if (u) {
    if (!cur || cur.uid !== u.uid || cur.th !== u.th) {
      // 계정당 기기 연결 변경 시간당 30회까지(D1 쓰기 보호) — 넘으면 이번엔 연결하지 않음(알림 구독 자체는 그대로)
      if (await limitAll(env, [{ k: 'dl:' + u.uid, ms: 3600e3, max: 30, cost: 1 }])) return false;
      await env.DB.batch([ // 이미 같은 계정·세션으로 묶여 있으면 쓰기 생략
      env.DB.prepare('INSERT OR REPLACE INTO devices (sid, uid, th, created) VALUES (?, ?, ?, ?)').bind(sid, u.uid, u.th, Date.now()),
      // 계정당 연결 기기 MAX_DEVICES대까지 — 넘으면 가장 오래된 연결을 끊음(그 기기 알림은 계정 없이 계속 옴) → 탈퇴 때 기기 구독을 빠짐없이 지울 수 있게
      env.DB.prepare('DELETE FROM devices WHERE uid = ? AND sid NOT IN (SELECT sid FROM devices WHERE uid = ? ORDER BY created DESC LIMIT ?)').bind(u.uid, u.uid, MAX_DEVICES),
      ]);
    }
  } else if (cur) await env.DB.prepare('DELETE FROM devices WHERE sid = ?').bind(sid).run();
  return !!u;
}
// 주기 정리(크론): 끝나지 않은 로그인 시작 기록·만료 세션·세션 없는 기기 연결
export async function sweepAccounts(env) {
  if (!env.DB) return;
  await init(env);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM logins WHERE created < ?').bind(now - STATE_MS),
    env.DB.prepare('DELETE FROM sessions WHERE created < ?').bind(now - SESSION_MS),
    env.DB.prepare('DELETE FROM devices WHERE th NOT IN (SELECT th FROM sessions)'),
    env.DB.prepare('DELETE FROM contacts WHERE (done > 0 AND done < ?) OR created < ?').bind(now - CONTACT_DONE_MS, now - CONTACT_MAX_MS), // 문의: 처리 후 6개월, 처리 안 했어도 받은 지 1년
  ]);
}

// 계정 경로가 아니면 null을 돌려준다 (worker.js의 나머지 경로로 넘어감)
// hooks.onAlert(sids, alert): 계정 알림 조건이 바뀌었을 때 묶인 기기 구독을 고치는 함수 (worker.js 제공)
export async function handleAccount(req, env, url, json, hooks = {}) {
  const p = url.pathname;
  if (!['/auth/kakao', '/auth/kakao/callback', '/auth/withdraw', '/me', '/logout', '/contact', '/admin/contacts'].includes(p)) return null;
  if (!env.DB || !env.KAKAO_REST_KEY) return json(req, { error: 'login not configured' }, 503);
  await init(env);
  // 사이트 안 문의하기 (로그인 필요 없음) — 운영자만 봄, 같은 접속지에서 1시간 5건까지
  if (p === '/contact' && req.method === 'POST') {
    // 이 사이트에서 보낸 JSON 요청만 (다른 사이트의 폼·text/plain 교차 요청으로 문의함을 채우지 못하게)
    if (req.headers.get('Origin') !== SITE) return json(req, { error: 'forbidden' }, 403);
    if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) return json(req, { error: 'bad request' }, 415);
    let b; try { b = await req.json(); } catch { return json(req, { error: 'bad request' }, 400); }
    if (!b || b.hp) return json(req, { ok: true }); // 자동 입력 봇은 조용히 무시
    const kind = ['delete', 'error', 'idea', 'etc'].includes(b.kind) ? b.kind : 'etc';
    const body = String(b.body || '').trim().slice(0, 2000), reply = String(b.reply || '').trim().slice(0, 100), page = String(b.page || '').slice(0, 300);
    if (body.length < 5) return json(req, { error: 'too short' }, 400);
    // 접속지(IPv4 주소·IPv6 /64) 시간당 5건, IPv6 /48 시간당 20건, 전체 하루 200건
    const now = Date.now(), ip = await ipKeys(req, env), ih = ip.ih;
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE ih = ? AND created > ?').bind(ih, now - 3600e3).first();
    if (n && n.n >= 5) return json(req, { error: 'too many', code: 'rate' }, 429);
    const rules = [{ k: 'cg', ms: 864e5, max: 200, cost: 1 }];
    if (ip.ih48) rules.push({ k: 'c48:' + ip.ih48, ms: 3600e3, max: 20, cost: 1 });
    if (await limitAll(env, rules, now)) return json(req, { error: 'too many', code: 'rate' }, 429);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO contacts (kind, body, reply, page, ih, created) VALUES (?, ?, ?, ?, ?, ?)').bind(kind, body, reply, page, ih, now),
      env.DB.prepare('DELETE FROM contacts WHERE (done > 0 AND done < ?) OR created < ?').bind(now - CONTACT_DONE_MS, now - CONTACT_MAX_MS), // 처리하고 6개월, 처리 안 했어도 1년 지난 문의 삭제
    ]);
    return json(req, { ok: true });
  }

  if (p === '/auth/kakao' && req.method === 'GET') {
    const mode = 'login'; // 탈퇴는 로그인한 상태에서 POST /auth/withdraw 로만 시작(링크만으로 탈퇴 상태를 못 만들게)
    const state = rand(18), ret = safeReturn(url.searchParams.get('return') || ''), now = Date.now();
    const n = /^[A-Za-z0-9_-]{16,64}$/.test(url.searchParams.get('n') || '') ? url.searchParams.get('n') : '';
    // 로그인 시작 횟수: 접속지(/64) 시간당 30·하루 100, IPv6 /48 시간당 100·하루 300 (D1 쓰기 보호)
    const ip = await ipKeys(req, env);
    const lr = [{ k: 'ka:' + ip.ih, ms: 3600e3, max: 30, cost: 1 }, { k: 'kad:' + ip.ih, ms: 864e5, max: 100, cost: 1 }];
    if (ip.ih48) lr.push({ k: 'ka48:' + ip.ih48, ms: 3600e3, max: 100, cost: 1 }, { k: 'ka48d:' + ip.ih48, ms: 864e5, max: 300, cost: 1 });
    if (await limitAll(env, lr, now)) return back(ret, 'login_error=rate');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM logins WHERE created < ?').bind(now - STATE_MS), // 끝나지 않은 로그인 시작 기록은 10분 뒤 정리
      env.DB.prepare('INSERT INTO logins (state, ret, mode, n, created) VALUES (?, ?, ?, ?, ?)').bind(state, ret, mode, n, now),
    ]);
    const q = new URLSearchParams({ response_type: 'code', client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/auth/kakao/callback', state });
    return new Response(null, { status: 302, headers: { Location: 'https://kauth.kakao.com/oauth/authorize?' + q, 'Cache-Control': 'no-store' } });
  }

  if (p === '/auth/kakao/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const st = await env.DB.prepare('SELECT ret, mode, n, uid, created FROM logins WHERE state = ?').bind(state).first();
    await env.DB.prepare('DELETE FROM logins WHERE state = ? OR created < ?').bind(state, Date.now() - STATE_MS).run();
    if (!st || Date.now() - st.created > STATE_MS) return back(SITE + '/', 'login_error=expired');
    const code = url.searchParams.get('code');
    if (!code) return back(st.ret, 'login_error=cancel');
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/auth/kakao/callback', code });
    if (env.KAKAO_CLIENT_SECRET) form.set('client_secret', env.KAKAO_CLIENT_SECRET);
    const tr = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) { console.log('kakao token', tr.status, tok.error_code || tok.error || ''); return back(st.ret, 'login_error=token'); }
    const auth = { Authorization: `Bearer ${tok.access_token}` };
    const me = await fetch('https://kapi.kakao.com/v2/user/me', { headers: auth }).then(r => r.json()).catch(() => ({}));
    if (!me.id) return back(st.ret, 'login_error=user');
    const uid = await sha(`${await salt(env)}:${me.id}`);
    if (st.mode === 'withdraw') {
      if (!st.uid || st.uid !== uid) return back(st.ret, 'login_error=mismatch'); // 탈퇴를 시작한 계정과 카카오에서 다시 로그인한 계정이 같을 때만 삭제
      // 계정에 묶였던 기기의 알림 구독도 삭제: 키를 대기열(kvdel)에 넣고(데이터 삭제와 한 트랜잭션) 이 요청에서 최대 400개 지움,
      // 남은 건 매시 정리가 이어서 (기기 연결은 계정당 MAX_DEVICES대라 보통 이 요청에서 끝남)
      // 순서: D1 삭제 먼저 → 성공해야 카카오 연결 해제 (삭제 실패 시 연결은 그대로 두고 다시 시도하게)
      try { await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO kvdel (sid) SELECT sid FROM devices WHERE uid = ?').bind(uid),
        env.DB.prepare('DELETE FROM reminders WHERE sh IN (SELECT substr(sid, 5) FROM devices WHERE uid = ?)').bind(uid),
        env.DB.prepare('DELETE FROM users WHERE uid = ?').bind(uid), env.DB.prepare('DELETE FROM sessions WHERE uid = ?').bind(uid), env.DB.prepare('DELETE FROM devices WHERE uid = ?').bind(uid)]); }
      catch (e) { console.log('withdraw d1', String(e && e.message || e)); return back(st.ret, 'login_error=withdraw'); }
      await fetch('https://kapi.kakao.com/v1/user/unlink', { method: 'POST', headers: auth }).catch(() => {});
      if (hooks.drainKvDel) await hooks.drainKvDel(400).catch(e => console.log('withdraw kv', String(e && e.message || e)));
      return back(st.ret, 'withdrawn=1' + (st.n ? '&n=' + st.n : ''));
    }
    const now = Date.now(), t = rand(32);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users (uid, data, updated, created) VALUES (?, '{}', 0, ?)").bind(uid, now),
      env.DB.prepare('INSERT INTO sessions (th, uid, created) VALUES (?, ?, ?)').bind(await sha(t), uid, now),
      env.DB.prepare('DELETE FROM sessions WHERE created < ?').bind(now - SESSION_MS),
    ]);
    return back(st.ret, 'login=' + t + (st.n ? '&n=' + st.n : ''));
  }

  // 로그인 안 한 방문자의 '로그인 기능 켜져 있나' 확인(토큰 없이 GET /me)은 401 대신 200 — 브라우저 콘솔 오류가 안 나게
  if (p === '/me' && req.method === 'GET' && !req.headers.get('Authorization')) return json(req, { login: false });
  const u = await who(req, env);
  if (!u) return json(req, { error: 'login required' }, 401);
  if (p === '/auth/withdraw' && req.method === 'POST') { // 탈퇴 시작: 로그인한 계정(uid)을 상태값에 묶고, 카카오에서 다시 로그인한 계정이 같을 때만 콜백에서 삭제
    const b = await req.json().catch(() => ({}));
    const state = rand(18), ret = safeReturn(String(b.return || '')), now = Date.now();
    const n = /^[A-Za-z0-9_-]{16,64}$/.test(b.n || '') ? b.n : '';
    await env.DB.batch([
      env.DB.prepare('DELETE FROM logins WHERE created < ?').bind(now - STATE_MS),
      env.DB.prepare('INSERT INTO logins (state, ret, mode, n, uid, created) VALUES (?, ?, ?, ?, ?, ?)').bind(state, ret, 'withdraw', n, u.uid, now),
    ]);
    const q = new URLSearchParams({ response_type: 'code', client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/auth/kakao/callback', state, prompt: 'login' });
    return json(req, { url: 'https://kauth.kakao.com/oauth/authorize?' + q });
  }
  if (p === '/me' && req.method === 'GET') {
    const row = await env.DB.prepare('SELECT data, updated FROM users WHERE uid = ?').bind(u.uid).first();
    if (!row) return json(req, { error: 'login required' }, 401);
    const dv = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE uid = ?').bind(u.uid).first();
    return json(req, { data: JSON.parse(row.data || '{}'), updated: row.updated, devices: dv ? dv.n : 0, uid: u.uid, admin: !!ADMIN_UID && u.uid === ADMIN_UID });
  }
  if (p === '/me' && req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_DATA) return json(req, { error: 'too large' }, 413);
    let body; try { body = JSON.parse(text); } catch { return json(req, { error: 'bad request' }, 400); }
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return json(req, { error: 'bad request' }, 400);
    const now = Date.now();
    // 계정당 분당 20회·시간당 300회 (D1 쓰기 보호 — 기기 동기화는 변경 때만 보내므로 정상 사용은 훨씬 적음)
    if (await limitAll(env, [{ k: 'mp:' + u.uid, ms: 60e3, max: 20, cost: 1 }, { k: 'mph:' + u.uid, ms: 3600e3, max: 300, cost: 1 }], now)) return json(req, { error: 'too many', code: 'rate' }, 429);
    const old = await env.DB.prepare('SELECT data FROM users WHERE uid = ?').bind(u.uid).first();
    await env.DB.prepare('UPDATE users SET data = ?, updated = ? WHERE uid = ?').bind(JSON.stringify(body.data), now, u.uid).run();
    let synced = 0;
    const alert = body.data.alert, oldAlert = old ? (JSON.parse(old.data || '{}').alert || null) : null;
    if (hooks.onAlert && alert && typeof alert === 'object' && alert.filters && JSON.stringify(alert) !== JSON.stringify(oldAlert)) {
      const { results } = await env.DB.prepare('SELECT sid FROM devices WHERE uid = ?').bind(u.uid).all();
      synced = await hooks.onAlert((results || []).map(r => r.sid), alert, u.uid);
    }
    return json(req, { ok: true, updated: now, synced });
  }
  if (p === '/logout' && req.method === 'POST') {
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE th = ?').bind(u.th), env.DB.prepare('DELETE FROM devices WHERE th = ?').bind(u.th)]);
    return json(req, { ok: true });
  }
  if (p === '/admin/contacts') { // 문의함 — 운영자 계정만
    if (!ADMIN_UID || u.uid !== ADMIN_UID) return json(req, { error: 'forbidden' }, 403);
    if (req.method === 'GET') {
      const r = await env.DB.prepare('SELECT id, kind, body, reply, page, created, done FROM contacts ORDER BY (done > 0), id DESC LIMIT 200').all();
      return json(req, { items: r.results || [] });
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json(req, { error: 'bad request' }, 400); }
      await env.DB.prepare('UPDATE contacts SET done = ? WHERE id = ?').bind(b.done ? Date.now() : 0, Number(b.id) || 0).run();
      return json(req, { ok: true });
    }
  }
  return json(req, { error: 'not found' }, 404);
}
