// 앱 껍데기는 캐시 우선, 목록 데이터는 네트워크 우선 (오프라인이면 마지막 목록)
// + 웹 푸시: 서버는 '새 글 있음' 신호만 보내고, 알림 내용은 여기서 목록을 읽어 만든다
const CACHE = 'bdr-v10'; // 10-30 저장 글 리마인더·알림 클릭 → 공유 페이지
const PUSH_API = 'https://bdrguest-push.hoopguest.workers.dev';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png', '/ball.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'bdr-state').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const networkFirst = u.pathname.endsWith('data.json') || e.request.mode === 'navigate';
  if (networkFirst) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});

const STATE = '/__push-state';
// 저장소 오류(용량 초과·손상)가 나도 알림은 반드시 띄워야 하므로 실패는 빈 상태로 처리
async function getState() { try { const c = await caches.open('bdr-state'); const r = await c.match(STATE); const v = r ? await r.json() : {}; return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
async function setState(s) { try { const c = await caches.open('bdr-state'); await c.put(STATE, new Response(JSON.stringify(s))); } catch {} }
function matches(f, p) {
  if (p.closed) return false;
  if (f.boards && f.boards.length && !f.boards.includes(p.board || 'guest')) return false;
  if (f.regions && f.regions.length) { if (!f.regions.includes(p.region2 || '기타')) return false; }
  else if (f.r1 && f.r1 !== '전체' && (p.region1 || '기타') !== f.r1) return false;
  if (f.slots && f.slots.length && !f.slots.includes(p.slot) && !(p.amb && (f.slots.includes('오전') || f.slots.includes('저녁')))) return false;
  if ((f.week && f.week !== '전체') || (f.days && f.days.length)) {
    if (!p.date) return false;
    const w = new Date(p.date + 'T00:00:00Z').getUTCDay();
    if (f.week && f.week !== '전체' && (f.week === '주말') !== (w === 0 || w === 6)) return false;
    if (f.days && f.days.length && !f.days.includes(w)) return false;
  }
  return true;
}
// 글별 공유 페이지 /p/<키>/ (scraper/pages.mjs의 postSlug와 같은 규칙) — 원문 버튼이 있어 사이트를 거쳐 카페로 간다
const postPath = key => '/p/' + String(key).replace(/[^A-Za-z0-9]/g, '-') + '/';
const unent = t => String(t).replace(/&(amp|lt|gt|quot|#34|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#34': '"', '#39': "'" })[k]);
// 저장 글 리마인더 알림 내용 (서버 /sub-state가 돌려준 시작 2시간 전 글). 없으면 null
function remindNote(list) {
  list = list.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (!list.length) return null;
  const line = x => `${x.start} ${unent(x.title || '저장한 글')}`;
  return {
    title: list.length === 1 ? `⏰ 곧 시작: ${line(list[0])}` : `⏰ 곧 시작: 저장한 글 ${list.length}건`,
    body: list.length === 1 ? '눌러서 글을 확인하세요' : list.slice(0, 3).map(line).join('\n'),
    url: list.length === 1 ? postPath(list[0].key) : '/my/', // 여러 건이면 저장한 글이 모인 마이페이지
  };
}
const remId = x => `${x.key}|${x.date}|${x.start}`;
const ICON = { icon: '/icon-192.png', badge: '/icon-192.png' };
// 서버는 cron마다 구독당 푸시 1번만 보낸다. 깨어나면 /sub-state에서 지금 조건 + 리마인더(due)를 같이 받아 알림을 만든다
// - due: 서버가 15분 안에 보낸 리마인더(받아 가면 서버에 전달 표시) / late: 늦게 깨어나 15분이 지난 리마인더(이 기기 기록으로 한 번만)
// - due가 null(서버 조회 실패)·/sub-state 실패면 '새 글이 올라왔어요'를 지어내지 않는다
// 푸시를 받고 알림을 하나도 안 띄우면 크롬은 '백그라운드에서 업데이트됨' 기본 알림을, 사파리는 3번째에 구독을 지운다
// → 보여줄 게 없으면 떠 있는 알림을 소리 없이 다시 띄우거나(바뀌는 것 없음) 조용한 '훕게스트' 알림 1개만(같은 tag로 교체)
self.addEventListener('push', e => {
  e.waitUntil(handlePush().catch(() => self.registration.showNotification('🏀 훕게스트', { body: '눌러서 새 글과 저장한 글을 확인하세요', tag: 'bdr-new', renotify: false, silent: true, ...ICON, data: { url: '/' } })));
});
async function handlePush() {
  let st = await getState(), srv = null;
  // 계정 맞춤 알림은 다른 기기에서 조건을 바꿀 수 있어 서버의 지금 조건을 먼저 읽는다 (실패하면 이 기기에 저장된 조건)
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (sub) {
      const r = await fetch(PUSH_API + '/sub-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (r.ok) {
        const v = await r.json();
        if (v && v.filters) { srv = v; st = { ...st, filters: v.filters, label: v.label || st.label, query: v.query || st.query || '' }; }
      }
    }
  } catch {}
  const f = st.filters || {};
  const notified = new Set(st.notified || []), remDone = new Set(st.remDone || []);
  let hits = [];
  try {
    const d = await (await fetch('/data.json?t=' + Date.now(), { cache: 'no-store' })).json();
    const now = Date.now(), today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
    hits = (d.posts || []).filter(p => p.key && !notified.has(p.key) && (!p.date || p.date >= today)
      && now - Date.parse(p.posted) < 9 * 3600e3 && matches(f, p));
  } catch {}
  hits.forEach(p => notified.add(p.key));
  const arr = x => Array.isArray(x) ? x.filter(y => y && y.key && y.date && y.start) : [];
  const rems = [...arr(srv && srv.due), ...arr(srv && srv.late)].filter(x => !remDone.has(remId(x)));
  rems.forEach(x => remDone.add(remId(x)));
  await setState({ ...st, notified: [...notified].slice(-500), remDone: [...remDone].slice(-200) }); // 서버에서 받은 조건도 같이 저장
  const rm = remindNote(rems);
  if (rm) await self.registration.showNotification(rm.title, { body: rm.body, tag: 'bdr-remind', renotify: true, requireInteraction: true, ...ICON, data: { url: rm.url } });
  const label = st.label || '관심 조건';
  if (hits.length) {
    return self.registration.showNotification(`🏀 새 글 ${hits.length}건 · ${label}`, {
      body: hits.slice(0, 3).map(p => (p.start ? `${p.start} ` : '') + unent(p.title)).join('\n'), tag: 'bdr-new', renotify: true, ...ICON,
      data: { url: hits.length === 1 ? postPath(hits[0].key) : '/' + (st.query ? '?' + st.query + '&s=new' : '?s=new') },
    });
  }
  if (rm) return;
  // 새 글 푸시인데 사이트 목록 반영이 늦은 경우(서버 확인 성공 + 리마인더 푸시 아님) → 기존처럼 '새 글이 올라왔어요'
  if (srv && !srv.rp && (Array.isArray(srv.due) || !('due' in srv))) { // 'due'가 없으면 이전 버전 서버(리마인더 없음) → 새 글 푸시
    return self.registration.showNotification(`🏀 ${label}에 새 글이 올라왔어요`, {
      body: '눌러서 목록을 확인하세요', tag: 'bdr-new', renotify: true, ...ICON, data: { url: '/' + (st.query ? '?' + st.query + '&s=new' : '?s=new') },
    });
  }
  // 그 밖(이미 받아 간 리마인더 신호·서버 조회 실패): 떠 있는 알림을 그대로 다시(소리 없음), 없으면 조용한 요약 1개
  let open = [];
  try { open = await self.registration.getNotifications(); } catch {}
  const n = open.filter(x => x.tag).pop();
  if (n) return self.registration.showNotification(n.title, { body: n.body, tag: n.tag, data: n.data, renotify: false, silent: true, requireInteraction: !!n.requireInteraction, ...ICON });
  return self.registration.showNotification('🏀 훕게스트', { body: '눌러서 새 글과 저장한 글을 확인하세요', tag: 'bdr-new', renotify: false, silent: true, ...ICON, data: { url: '/' } });
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url || '/';
  e.waitUntil(clients.openWindow(url));
});
