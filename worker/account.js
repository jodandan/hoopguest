// 훕게스트 계정(카카오 로그인, 선택) — 저장한 글·설정·알림 조건을 기기끼리 동기화
// - GET  /auth/kakao?mode=login|withdraw&return=… : 카카오 로그인 화면으로 보냄
// - GET  /auth/kakao/callback                     : 로그인 완료 → 사이트로 돌아가며 #login=<토큰> 전달
//                                                   (탈퇴 모드면 카카오 연결 끊기 + 데이터 삭제 → #withdrawn=1)
// - GET  /me · PUT /me                             : 내 데이터 읽기·저장 (Authorization: Bearer <토큰>)
// - POST /logout                                   : 이 기기 로그인 토큰 삭제
// 맞춤 알림: 로그인한 채 알림을 켠 기기는 devices(sid → uid)로 계정에 묶이고, 계정의 알림 조건(data.alert)이 바뀌면
//           worker.js가 넘겨준 onAlert로 묶인 기기 구독 조건을 모두 바꾼다
// 저장소: D1 "DB" — users(uid, data, updated, created) · sessions(th, uid, created) · logins(state, ret, mode, created) · devices(sid, uid, th, created) · meta(k, v)
// 개인정보: 카카오에서 받는 건 회원번호뿐. 서버엔 '비밀 소금 + 회원번호'의 SHA-256 값(uid)만 저장하고,
//           회원번호 원문·이름·이메일·카카오 토큰은 저장하지 않는다. 로그인 토큰도 해시로만 보관.
// 시크릿: KAKAO_REST_KEY(로그인에 쓸 REST API 키) / 선택: KAKAO_CLIENT_SECRET(카카오 콘솔에서 켰을 때만)
const SITE = 'https://hoopguest.kro.kr';
const ADMIN_UID = 'FfLxir2WfmLQg7tgKd_4mBMDRwyFPbWUFXuqOwei8E8'; // 운영자 계정 식별자(해시값) — 문의함을 볼 수 있는 계정
const RETURN_OK = [SITE, 'https://bdrguest.kro.kr', 'https://jodandan.github.io'];
const SESSION_MS = 180 * 864e5, STATE_MS = 10 * 60e3, MAX_DATA = 32000;

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

let ready = null;
function init(env) {
  if (!ready) ready = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS logins (state TEXT PRIMARY KEY, ret TEXT NOT NULL, mode TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS devices (sid TEXT PRIMARY KEY, uid TEXT NOT NULL, th TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL, reply TEXT NOT NULL, page TEXT NOT NULL, ih TEXT NOT NULL, created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)'),
  ]).catch(e => { ready = null; throw e; });
  return ready;
}
async function salt(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'salt'").first();
  if (row) return row.v;
  await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', ?)").bind(rand(32)).run();
  return (await env.DB.prepare("SELECT v FROM meta WHERE k = 'salt'").first()).v;
}
function safeReturn(r) {
  try { const u = new URL(r); if (RETURN_OK.includes(u.origin)) return u.origin + u.pathname + u.search; } catch {}
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
  if (u) await env.DB.prepare('INSERT OR REPLACE INTO devices (sid, uid, th, created) VALUES (?, ?, ?, ?)').bind(sid, u.uid, u.th, Date.now()).run();
  else await env.DB.prepare('DELETE FROM devices WHERE sid = ?').bind(sid).run();
  return !!u;
}
export async function unlinkDevice(env, sid) {
  if (!env.DB) return;
  await init(env);
  await env.DB.prepare('DELETE FROM devices WHERE sid = ?').bind(sid).run();
}

// 계정 경로가 아니면 null을 돌려준다 (worker.js의 나머지 경로로 넘어감)
// hooks.onAlert(sids, alert): 계정 알림 조건이 바뀌었을 때 묶인 기기 구독을 고치는 함수 (worker.js 제공)
export async function handleAccount(req, env, url, json, hooks = {}) {
  const p = url.pathname;
  if (!['/auth/kakao', '/auth/kakao/callback', '/me', '/logout', '/contact', '/admin/contacts'].includes(p)) return null;
  if (!env.DB || !env.KAKAO_REST_KEY) return json(req, { error: 'login not configured' }, 503);
  await init(env);
  // 사이트 안 문의하기 (로그인 필요 없음) — 운영자만 봄, 같은 접속지에서 1시간 5건까지
  if (p === '/contact' && req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json(req, { error: 'bad request' }, 400); }
    if (!b || b.hp) return json(req, { ok: true }); // 자동 입력 봇은 조용히 무시
    const kind = ['delete', 'error', 'idea', 'etc'].includes(b.kind) ? b.kind : 'etc';
    const body = String(b.body || '').trim().slice(0, 2000), reply = String(b.reply || '').trim().slice(0, 100), page = String(b.page || '').slice(0, 300);
    if (body.length < 5) return json(req, { error: 'too short' }, 400);
    const now = Date.now(), ih = await sha((req.headers.get('CF-Connecting-IP') || '-') + ':' + await salt(env));
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE ih = ? AND created > ?').bind(ih, now - 3600e3).first();
    if (n && n.n >= 5) return json(req, { error: 'too many' }, 429);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO contacts (kind, body, reply, page, ih, created) VALUES (?, ?, ?, ?, ?, ?)').bind(kind, body, reply, page, ih, now),
      env.DB.prepare('DELETE FROM contacts WHERE done > 0 AND done < ?').bind(now - 180 * 864e5), // 처리하고 6개월 지난 문의 삭제
    ]);
    return json(req, { ok: true });
  }

  if (p === '/auth/kakao' && req.method === 'GET') {
    const mode = url.searchParams.get('mode') === 'withdraw' ? 'withdraw' : 'login';
    const state = rand(18), ret = safeReturn(url.searchParams.get('return') || '');
    await env.DB.prepare('INSERT INTO logins (state, ret, mode, created) VALUES (?, ?, ?, ?)').bind(state, ret, mode, Date.now()).run();
    const q = new URLSearchParams({ response_type: 'code', client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/auth/kakao/callback', state });
    return new Response(null, { status: 302, headers: { Location: 'https://kauth.kakao.com/oauth/authorize?' + q, 'Cache-Control': 'no-store' } });
  }

  if (p === '/auth/kakao/callback' && req.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const st = await env.DB.prepare('SELECT ret, mode, created FROM logins WHERE state = ?').bind(state).first();
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
      await fetch('https://kapi.kakao.com/v1/user/unlink', { method: 'POST', headers: auth }).catch(() => {});
      await env.DB.batch([env.DB.prepare('DELETE FROM users WHERE uid = ?').bind(uid), env.DB.prepare('DELETE FROM sessions WHERE uid = ?').bind(uid), env.DB.prepare('DELETE FROM devices WHERE uid = ?').bind(uid)]);
      return back(st.ret, 'withdrawn=1');
    }
    const now = Date.now(), t = rand(32);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users (uid, data, updated, created) VALUES (?, '{}', 0, ?)").bind(uid, now),
      env.DB.prepare('INSERT INTO sessions (th, uid, created) VALUES (?, ?, ?)').bind(await sha(t), uid, now),
      env.DB.prepare('DELETE FROM sessions WHERE created < ?').bind(now - SESSION_MS),
    ]);
    return back(st.ret, 'login=' + t);
  }

  // 로그인 안 한 방문자의 '로그인 기능 켜져 있나' 확인(토큰 없이 GET /me)은 401 대신 200 — 브라우저 콘솔 오류가 안 나게
  if (p === '/me' && req.method === 'GET' && !req.headers.get('Authorization')) return json(req, { login: false });
  const u = await who(req, env);
  if (!u) return json(req, { error: 'login required' }, 401);
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
    if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) return json(req, { error: 'bad request' }, 400);
    const now = Date.now();
    const old = await env.DB.prepare('SELECT data FROM users WHERE uid = ?').bind(u.uid).first();
    await env.DB.prepare('UPDATE users SET data = ?, updated = ? WHERE uid = ?').bind(JSON.stringify(body.data), now, u.uid).run();
    let synced = 0;
    const alert = body.data.alert, oldAlert = old ? (JSON.parse(old.data || '{}').alert || null) : null;
    if (hooks.onAlert && alert && typeof alert === 'object' && alert.filters && JSON.stringify(alert) !== JSON.stringify(oldAlert)) {
      const { results } = await env.DB.prepare('SELECT sid FROM devices WHERE uid = ?').bind(u.uid).all();
      synced = await hooks.onAlert((results || []).map(r => r.sid), alert);
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
      const r = await env.DB.prepare('SELECT id, kind, body, reply, page, created, done FROM contacts ORDER BY id DESC LIMIT 200').all();
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
