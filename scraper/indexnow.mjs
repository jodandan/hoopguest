// 바뀐 페이지를 IndexNow(네이버·빙 등)로 알림 — 같은 주소는 6시간에 한 번만
// 사용: node scraper/indexnow.mjs <바뀐 파일 경로...>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const SITE = 'https://hoopguest.kro.kr', HOST = 'hoopguest.kro.kr';
const KEY = 'bddf8836eb999e8a6435b6d7f52cc56e';
const STATE = new URL('../data/indexnow.json', import.meta.url);
const GAP = 6 * 3600e3;
const toUrl = f => {
  f = f.replace(/^"|"$/g, '');
  if (f === 'docs/index.html') return SITE + '/';
  const m = f.match(/^docs\/(r\/(?:[a-z-]+\/){1,2})(?:index\.html)?$/);
  return m ? SITE + '/' + m[1] : null;
};
const urls = [...new Set(process.argv.slice(2).map(toUrl).filter(Boolean))];
let st = {};
try { st = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
const now = Date.now();
const due = urls.filter(u => !st[u] || now - st[u] > GAP).slice(0, 100);
if (!due.length) { console.log('indexnow: 보낼 주소 없음'); process.exit(0); }
const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: due });
for (const ep of ['https://searchadvisor.naver.com/indexnow', 'https://api.indexnow.org/IndexNow']) {
  try {
    const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
    console.log('indexnow', ep, r.status, due.length + '건');
  } catch (e) { console.log('indexnow 실패', ep, e.message); }
}
for (const u of due) st[u] = now;
await mkdir(new URL('.', STATE), { recursive: true });
await writeFile(STATE, JSON.stringify(st));
