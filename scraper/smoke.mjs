// 화면 점검(스모크 테스트) — 첫 화면이 실제로 카드 목록을 그리는지 헤드리스 브라우저로 확인
//   node scraper/smoke.mjs            → 저장소의 docs/ 를 로컬 서버로 띄워 점검(배포 전)
//   node scraper/smoke.mjs https://hoopguest.kro.kr  → 실사이트 점검(정기 감시) + 수집 멈춤 확인
// 실패하면 종료 코드 1 → GitHub Actions 빨간불·메일
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // require는 NODE_PATH(전역 설치)도 찾음

const LIVE = process.argv[2];
const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };

function serve() {
  const srv = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      let f = join(DOCS, p);
      if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
      const body = await readFile(f);
      res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const fails = [];
const fail = m => { fails.push(m); console.log('✗ ' + m); };
const ok = m => console.log('✓ ' + m);

const srv = LIVE ? null : await serve();
const BASE = LIVE ? LIVE.replace(/\/$/, '') : `http://127.0.0.1:${srv.address().port}`;
console.log(`점검 대상: ${BASE}`);

const browser = await chromium.launch();
try {
  for (const vw of [{ width: 360, height: 780, name: '모바일' }, { width: 1280, height: 900, name: 'PC' }]) {
    const ctx = await browser.newContext({ viewport: vw, serviceWorkers: 'block', locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && m.text().startsWith('[훕게스트]')) errs.push(m.text()); });
    // 로컬 점검에선 외부(광고·분석·지도·로그인 서버) 요청을 막아 결과가 네트워크에 흔들리지 않게
    if (!LIVE) await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());

    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#list article') || document.querySelector('#list [data-err], #list .state'), null, { timeout: 20000 }).catch(() => {});
    const first = await page.evaluate(() => ({ cards: document.querySelectorAll('#list article').length, err: document.querySelector('#list [data-err]')?.dataset.err || '', text: document.querySelector('#list')?.innerText.slice(0, 80) || '' }));
    if (first.err) fail(`[${vw.name}] 첫 화면 오류 표시(${first.err}): ${first.text.replace(/\s+/g, ' ')}`);
    else if (first.cards < 1) fail(`[${vw.name}] 첫 화면에 카드가 0개: ${first.text.replace(/\s+/g, ' ')}`);
    else ok(`[${vw.name}] 첫 화면 카드 ${first.cards}개`);

    // 게시판 탭마다 오류 없이 그려지는지
    const tabs = await page.locator('#tabs [role=tab]').all();
    for (const t of tabs) {
      const name = (await t.innerText()).replace(/\s+/g, ' ').trim();
      await t.click(); await page.waitForTimeout(500);
      const r = await page.evaluate(() => ({ cards: document.querySelectorAll('#list article').length, err: document.querySelector('#list [data-err]')?.dataset.err || '' }));
      if (r.err) fail(`[${vw.name}] '${name}' 탭 오류 표시(${r.err})`);
      else if (r.cards < 1 && !/\b0\b/.test(name)) fail(`[${vw.name}] '${name}' 탭에 카드가 0개`);
    }
    if (tabs.length) ok(`[${vw.name}] 게시판 탭 ${tabs.length}개 확인`);
    else fail(`[${vw.name}] 게시판 탭을 찾지 못함`);

    // 부품 모음(/design/)이 첫 화면 CSS를 불러와 카드를 그리는지
    await page.goto(BASE + '/design/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#cards article').length && document.getElementById('appcss')?.textContent.length > 1000, null, { timeout: 10000 }).catch(() => {});
    const ds = await page.evaluate(() => ({ cards: document.querySelectorAll('#cards article').length, css: document.getElementById('appcss')?.textContent.length || 0, over: document.documentElement.scrollWidth > innerWidth + 1 }));
    if (!ds.cards || ds.css < 1000) fail(`[${vw.name}] 부품 모음 페이지가 비어 있음(카드 ${ds.cards}, CSS ${ds.css}자)`);
    else if (ds.over) fail(`[${vw.name}] 부품 모음 페이지가 가로로 넘침`);
    else ok(`[${vw.name}] 부품 모음 카드 ${ds.cards}개`);

    // 마이페이지도 스크립트 오류 없이 열리는지
    await page.goto(BASE + '/my/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    if (errs.length) fail(`[${vw.name}] 스크립트 오류 ${errs.length}건: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
    else ok(`[${vw.name}] 스크립트 오류 없음`);
    await ctx.close();
  }

  // 폰 터치 동작(로컬 점검만): 카드를 왼쪽으로 밀면 저장, 맨 위에서 아래로 당기면 새로고침
  if (!LIVE) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block', locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#list article', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
    const bb = await page.locator('#list article.card').first().boundingBox();
    if (bb) {
      const y = bb.y + bb.height / 2, x0 = bb.x + bb.width - 40;
      await touch('touchStart', [[x0, y]]);
      for (let i = 1; i <= 12; i++) { await touch('touchMove', [[x0 - i * 12, y]]); await page.waitForTimeout(16); }
      await touch('touchEnd', []); await page.waitForTimeout(600);
      const saved = await page.evaluate(() => document.querySelector('#list article.card .star')?.getAttribute('aria-pressed'));
      if (saved === 'true') ok('[폰] 밀어서 저장 동작'); else fail('[폰] 카드를 밀어도 저장되지 않음');
    } else fail('[폰] 카드를 찾지 못해 밀어서 저장 점검 못 함');
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
    let refetch = 0; page.on('request', r => { if (r.url().includes('/data.json')) refetch++; });
    await touch('touchStart', [[200, 300]]);
    for (let i = 1; i <= 14; i++) { await touch('touchMove', [[200, 300 + i * 12]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []); await page.waitForTimeout(1200);
    if (refetch > 0) ok('[폰] 당겨서 새로고침 동작'); else fail('[폰] 당겨도 새 글을 받지 않음');
    await ctx.close();
  }

  // 실사이트 점검일 때만: 수집이 멈추지 않았는지(마지막 업데이트 3시간 이내)
  if (LIVE) {
    const d = await fetch(BASE + '/data.json?t=' + Date.now()).then(r => r.json()).catch(() => null);
    if (!d) fail('data.json 을 받지 못함');
    else {
      const h = (Date.now() - Date.parse(d.updated)) / 3600e3;
      if (!(h < 3)) fail(`목록 업데이트가 ${h.toFixed(1)}시간째 멈춤 (updated ${d.updated})`);
      else ok(`목록 업데이트 ${Math.round(h * 60)}분 전 · 글 ${d.posts?.length ?? 0}건`);
    }
  }
} finally {
  await browser.close();
  srv?.close();
}

if (fails.length) { console.log(`\n실패 ${fails.length}건`); process.exit(1); }
console.log('\n모두 통과');
