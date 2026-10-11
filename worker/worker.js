// 훕게스트(hoopguest) — 알림 서버 (Cloudflare Workers 무료 플랜)
// - POST /subscribe, /unsubscribe : 웹 푸시 구독 저장/삭제 (알림 주소 + 조건만 저장)
// - GET  /vapid                   : 푸시 공개키 (최초 요청 때 자동 생성해 KV에 보관)
// - POST /sub-state               : 구독 주소로 지금 알림 조건(조건·이름·링크) 조회 — 서비스워커가 알림 만들 때 사용
// - cron(10분마다)                : 사이트 data.json의 새 글 확인 → 조건 맞는 구독자에게 푸시
//                                   + 매시 0·30분엔 GitHub 수집 워크플로 실행 요청
// 바인딩: KV "SUBS" / 시크릿: GH_TOKEN(선택, 워크플로 실행 권한)
import { handleAccount, linkDevice, unlinkDevice } from './account.js'; // 카카오 로그인·기기 동기화 (/auth/kakao, /me, /logout)
const SITE = 'https://hoopguest.kro.kr';
const REPO = 'jodandan/bdr-guest';
const WORKFLOW = 'scrape.yml';
// 사이트 HTTPS 인증서 발급 전·장애 시에도 읽히도록 저장소 원본을 직접 읽는다
const DATA_URL = `https://raw.githubusercontent.com/${REPO}/main/docs/data.json`;
const ORIGINS = [SITE, 'https://bdrguest.kro.kr', 'http://hoopguest.kro.kr', 'http://bdrguest.kro.kr', 'http://localhost:8766'];

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
async function vapid(env) {
  let v = await env.SUBS.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.SUBS.put('vapid', JSON.stringify(v));
  }
  return v;
}
export async function vapidJwt(v, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: SITE })));
  const key = await crypto.subtle.importKey('jwk', v.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
// 내용 없는 푸시(tickle): 알림 내용은 기기의 서비스워커가 사이트 목록을 읽어 조건에 맞게 만든다
async function push(v, sub) {
  const jwt = await vapidJwt(v, sub.endpoint);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `vapid t=${jwt}, k=${v.pub}`, 'TTL': '21600', 'Urgency': 'high', 'Content-Length': '0' },
  });
  return r.status;
}

// ---- 조건 매칭 (사이트/서비스워커와 같은 규칙) ----
export function matches(f, p) {
  if (p.closed) return false;
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
// 계정 알림 조건이 바뀌면 그 계정에 묶인 기기 구독을 모두 같은 조건으로 (KV 쓰기 = 기기 수)
async function applyAlert(env, sids, alert) {
  let n = 0;
  for (const sid of sids.slice(0, 20)) {
    const v = await env.SUBS.get(sid, 'json');
    if (!v) { await unlinkDevice(env, sid).catch(() => {}); continue; }
    await env.SUBS.put(sid, JSON.stringify({ ...v, filters: cleanFilters(alert.filters), label: str(alert.label, 80), query: str(alert.query, 300), at: Date.now() }));
    n++;
  }
  return n;
}

async function listSubs(env) {
  const out = []; let cursor;
  do {
    const r = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of r.keys) { const v = await env.SUBS.get(k.name, 'json'); if (v) out.push({ id: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

// 새 글 확인 → 푸시
export async function checkAndPush(env, now = Date.now()) {
  // 조용한 시간(KST 0~7시): 보내지 않고 기록도 건드리지 않음 → 7시 이후 첫 확인 때 밤사이 글을 한 번에 알림
  const kh = new Date(now + 9 * 3600e3).getUTCHours();
  if (kh < 7) return { quiet: true };
  const res = await fetch(`${DATA_URL}?t=${now}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return { error: `data.json ${res.status}` };
  const d = await res.json();
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  const live = (d.posts || []).filter(p => p.key && !p.closed && (!p.date || p.date >= today));
  const seen = new Set((await env.SUBS.get('seen', 'json')) || []);
  const first = seen.size === 0;
  const fresh = first ? [] : live.filter(p => !seen.has(p.key) && now - Date.parse(p.posted) < 9 * 3600e3);
  await env.SUBS.put('seen', JSON.stringify(live.map(p => p.key).slice(0, 2000)));
  if (!fresh.length) return { fresh: 0, first };
  const v = await vapid(env);
  let sent = 0, removed = 0;
  for (const s of await listSubs(env)) {
    if (!fresh.some(p => matches(s.filters, p))) continue;
    const st = await push(v, s.sub).catch(() => 0);
    if (st === 404 || st === 410) { await env.SUBS.delete(s.id); removed++; }
    else if (st >= 200 && st < 300) sent++;
  }
  return { fresh: fresh.length, sent, removed };
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
        const body = await req.json();
        const sub = body.subscription;
        if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || JSON.stringify(body).length > 4000) return json(req, { error: 'bad request' }, 400);
        const id = 'sub:' + await sha(sub.endpoint);
        await env.SUBS.put(id, JSON.stringify({ sub: { endpoint: sub.endpoint }, filters: cleanFilters(body.filters), label: str(body.label, 80), query: str(body.query, 300), at: Date.now() }));
        const linked = await linkDevice(req, env, id).catch(() => null); // 로그인 중이면 계정에 묶음
        return json(req, { ok: true, linked: !!linked });
      }
      if (url.pathname === '/unsubscribe' && req.method === 'POST') {
        const { endpoint } = await req.json();
        if (endpoint) { const id = 'sub:' + await sha(endpoint); await env.SUBS.delete(id); await unlinkDevice(env, id).catch(() => {}); }
        return json(req, { ok: true });
      }
      if (url.pathname === '/sub-state' && req.method === 'POST') {
        const { endpoint } = await req.json();
        const v = typeof endpoint === 'string' && /^https:\/\//.test(endpoint) ? await env.SUBS.get('sub:' + await sha(endpoint), 'json') : null;
        if (!v) return json(req, { error: 'not found' }, 404);
        return json(req, { filters: v.filters || {}, label: v.label || '', query: v.query || '' });
      }
      const acc = await handleAccount(req, env, url, json, { onAlert: (sids, alert) => applyAlert(env, sids, alert) });
      if (acc) return acc;
      if (url.pathname === '/health') return json(req, { ok: true });
      return json(req, { error: 'not found' }, 404);
    } catch (e) { return json(req, { error: 'server error' }, 500); }
  },
  async scheduled(event, env, ctx) {
    const now = event.scheduledTime || Date.now();
    const min = new Date(now).getUTCMinutes();
    ctx.waitUntil((async () => {
      const r = await checkAndPush(env, now);
      console.log('push', JSON.stringify(r));
      if (min % 30 < 10) console.log('dispatch', await dispatchScrape(env));
    })());
  },
};
