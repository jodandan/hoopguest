// 글별 공유 썸네일(카톡·문자 미리보기 1200x630) 만들기 — docs/og/p/<글>-<해시>.jpg
// pages.mjs가 남긴 .og-jobs.json을 읽어
//   1) 없는 그림만 새로 그리고  2) 지금 글 목록에 없는 그림은 지우고
//   3) 그림이 생긴 글의 공유 페이지(docs/p/) og:image를 글별 그림으로 바꿔 끼운다.
// 그림을 못 그리면 공유 페이지는 동네 공용 그림(og/<광역>-<동네>.jpg)을 그대로 쓴다.
// Actions: npm i --no-save playwright-core 후 러너에 깔린 크롬으로 실행 / 로컬: playwright
import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('docs/og/p/', ROOT);
const SITE = 'https://hoopguest.kro.kr';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PIN = '<svg width="34" height="34" viewBox="0 0 24 24" style="vertical-align:-4px;margin-right:6px"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" fill="#CF3326"/><circle cx="12" cy="9.5" r="2.6" fill="#141414"/></svg>'; // 러너에 이모지 글꼴이 없어 그림으로
const BALL = '<svg width="58" height="58" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#E8742C" stroke="#121212" stroke-width="1.3"/><path d="M1.5 12h21M12 1.5v21M4.7 4.6c3.2 3.3 3.2 11.5 0 14.8M19.3 4.6c-3.2 3.3-3.2 11.5 0 14.8" fill="none" stroke="#121212" stroke-width="1.3"/></svg>';

function html(j) {
  const date = j.date || '일정은 원문 확인';
  const dSize = j.date ? 112 : 64;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Oswald:wght@700&display=block">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;font-family:Pretendard,"Noto Sans CJK KR",sans-serif;color:#F2EEE6;position:relative;
 background:radial-gradient(90% 80% at 85% 0%,#262626 0%,#141414 60%),#141414}
.hd{position:absolute;left:60px;right:60px;top:44px;display:flex;align-items:center;gap:14px}
.hd b{font:400 46px/1 "Black Han Sans","Noto Sans CJK KR",sans-serif;letter-spacing:-.5px}
.hd i{margin-left:auto;font-style:normal;font-size:30px;font-weight:800;background:#CF3326;color:#fff;padding:8px 22px;border-radius:999px}
.wood{position:absolute;left:-24px;top:142px;width:${j.time ? 700 : 1000}px;height:190px;transform:rotate(-2deg);
 background:repeating-linear-gradient(90deg,#D9A86C 0 120px,#CF9E62 120px 122px,#D6A469 122px 240px,#CC9B60 240px 242px);
 clip-path:polygon(0 5%,8% 0,22% 4%,38% 0,55% 3%,72% 0,88% 4%,100% 0,98% 35%,100% 70%,97% 100%,80% 96%,62% 100%,44% 97%,26% 100%,10% 96%,0 100%,2% 60%);
 display:flex;align-items:center;padding:0 30px 0 92px;color:#1A1208}
.wood:before{content:"";position:absolute;left:58px;top:36px;bottom:36px;width:10px;background:#CF3326}
.wood strong{font:400 ${dSize}px/1 "Black Han Sans","Noto Sans CJK KR",sans-serif;letter-spacing:-2px;white-space:nowrap}
.sb{position:absolute;right:60px;top:150px;width:420px;height:180px;background:#08090A;border:4px solid #2B2D31;border-radius:18px;
 display:flex;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.sb span{font:700 128px/1 Oswald,"Noto Sans CJK KR",sans-serif;color:#FFB23E;letter-spacing:4px;text-shadow:0 0 22px rgba(255,150,30,.55)}
.ft{position:absolute;left:60px;right:60px;bottom:52px}
.ft h1{font:400 76px/1.05 "Black Han Sans","Noto Sans CJK KR",sans-serif;letter-spacing:-1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ft p{margin-top:16px;display:flex;justify-content:space-between;align-items:flex-end;gap:24px}
.ft p span{font-size:40px;font-weight:700;color:#C9C3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ft p em{font-style:normal;font-size:28px;font-weight:700;color:#FFB547;white-space:nowrap}
.cl{position:absolute;right:90px;top:120px;transform:rotate(8deg);border:8px solid #CF3326;color:#CF3326;background:rgba(20,20,20,.8);font:400 90px/1 "Black Han Sans","Noto Sans CJK KR",sans-serif;padding:14px 30px;border-radius:14px}
</style></head><body>
<div class="hd">${BALL}<b>훕게스트</b><i>${esc(j.kind)}</i></div>
<div class="wood"><strong>${esc(date)}</strong></div>
${j.time ? `<div class="sb"><span>${esc(j.time)}</span></div>` : ''}
${j.closed ? '<div class="cl">마감</div>' : ''}
<div class="ft"><h1>${esc(j.area || '수도권')}</h1><p><span>${j.venue ? `${PIN}${esc(j.venue)}` : j.closed ? '모집이 끝난 글이에요' : '같이 뛸 사람?'}</span><em>hoopguest.kro.kr</em></p></div>
</body></html>`;
}

async function browser() {
  try { const { chromium } = await import('playwright-core'); return await chromium.launch({ channel: 'chrome' }); } catch {}
  const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright'); return chromium.launch(); // 로컬(전역 설치)
}

const jobs = JSON.parse(await readFile(new URL('.og-jobs.json', ROOT), 'utf8'));
await mkdir(OUT, { recursive: true });
const want = new Set(jobs.map(j => j.file));
let removed = 0;
for (const f of await readdir(OUT)) if (!want.has(f)) { await rm(new URL(f, OUT)); removed++; }

const todo = jobs.filter(j => !existsSync(new URL(j.file, OUT)));
let made = 0;
if (todo.length) {
  const b = await browser();
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const j of todo) {
    try {
      await pg.setContent(html(j), { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await pg.evaluate(() => document.fonts.ready);
      await pg.screenshot({ path: new URL(j.file, OUT).pathname, type: 'jpeg', quality: 65 });
      made++;
    } catch (e) { console.log('그림 실패', j.file, e.message); }
  }
  await b.close();
}

// 그림이 있는 글은 공유 페이지 og:image를 글별 그림으로
let patched = 0;
for (const j of jobs) {
  if (!existsSync(new URL(j.file, OUT))) continue;
  const pu = new URL('docs' + j.page + 'index.html', ROOT);
  if (!existsSync(pu)) continue;
  const h = await readFile(pu, 'utf8');
  const n = h.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${SITE}/og/p/${j.file}$2`);
  if (n !== h) { await writeFile(pu, n); patched++; }
}
console.log(`글별 썸네일: 새로 ${made} · 지움 ${removed} · 페이지 반영 ${patched} · 전체 ${jobs.length}`);
