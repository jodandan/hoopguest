// 앱 껍데기는 캐시 우선, 목록 데이터는 네트워크 우선 (오프라인이면 마지막 목록)
// + 웹 푸시: 서버는 '새 글 있음' 신호만 보내고, 알림 내용은 여기서 목록을 읽어 만든다
const CACHE = 'bdr-v9'; // 10-11 아이콘 교체
const PUSH_API = 'https://bdrguest-push.kiss970322.workers.dev';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/ball.svg'];
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
async function getState() { const c = await caches.open('bdr-state'); const r = await c.match(STATE); return r ? r.json() : {}; }
async function setState(s) { const c = await caches.open('bdr-state'); await c.put(STATE, new Response(JSON.stringify(s))); }
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
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let st = await getState();
    // 계정 맞춤 알림은 다른 기기에서 조건을 바꿀 수 있어 서버의 지금 조건을 먼저 읽는다 (실패하면 이 기기에 저장된 조건)
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch(PUSH_API + '/sub-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (r.ok) { const v = await r.json(); if (v && v.filters) st = { ...st, filters: v.filters, label: v.label || st.label, query: v.query || st.query || '' }; }
      }
    } catch {}
    const f = st.filters || {};
    const notified = new Set(st.notified || []);
    let hits = [];
    try {
      const d = await (await fetch('/data.json?t=' + Date.now(), { cache: 'no-store' })).json();
      const now = Date.now(), today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
      hits = (d.posts || []).filter(p => p.key && !notified.has(p.key) && (!p.date || p.date >= today)
        && now - Date.parse(p.posted) < 9 * 3600e3 && matches(f, p));
    } catch {}
    hits.forEach(p => notified.add(p.key));
    await setState({ ...st, notified: [...notified].slice(-500) }); // 서버에서 받은 조건도 같이 저장
    const label = st.label || '관심 조건';
    const title = hits.length ? `🏀 새 글 ${hits.length}건 · ${label}` : `🏀 ${label}에 새 글이 올라왔어요`;
    const unent = t => String(t).replace(/&(amp|lt|gt|quot|#34|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#34': '"', '#39': "'" })[k]);
    const body = hits.length ? hits.slice(0, 3).map(p => (p.start ? `${p.start} ` : '') + unent(p.title)).join('\n') : '눌러서 목록을 확인하세요';
    await self.registration.showNotification(title, {
      body, tag: 'bdr-new', renotify: true, icon: '/icon-192.png', badge: '/icon-192.png',
      data: { url: hits.length === 1 ? hits[0].url : '/' + (st.query ? '?' + st.query + '&s=new' : '?s=new') },
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url || '/';
  e.waitUntil(clients.openWindow(url));
});
