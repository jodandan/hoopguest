// 검색엔진용 지역별 정적 페이지 + 사이트맵 생성 (수집 때마다 갱신)
// docs/r/<광역>/index.html, docs/r/<광역>/<동네>/index.html, docs/sitemap.xml
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SITE = 'https://hoopguest.kro.kr';
const DOCS = new URL('../docs/', import.meta.url);
const LASTMOD = new URL('../data/lastmod.json', import.meta.url); // 페이지별 마지막으로 내용이 바뀐 날(사이트맵 lastmod용)
const HIST = new URL('../data/history.json', import.meta.url); // 지역 페이지 '최근 경향' 통계용 누적 기록(공개 안 됨)
const GA_ID = 'G-0DWSLR5007';

export const R1 = { 서울: 'seoul', 경기: 'gyeonggi', 인천: 'incheon' };
// [표시명(데이터 region2), 슬러그, 위도, 경도]
export const DISTRICTS = {
  서울: [['강남', 'gangnam', 37.517, 127.047], ['강동', 'gangdong', 37.530, 127.124], ['강북', 'gangbuk', 37.640, 127.026], ['강서', 'gangseo', 37.551, 126.850], ['관악', 'gwanak', 37.478, 126.952], ['광진', 'gwangjin', 37.539, 127.082], ['구로', 'guro', 37.496, 126.888], ['금천', 'geumcheon', 37.457, 126.896], ['노원', 'nowon', 37.654, 127.057], ['도봉', 'dobong', 37.669, 127.047], ['동대문', 'dongdaemun', 37.574, 127.040], ['동작', 'dongjak', 37.512, 126.939], ['마포', 'mapo', 37.566, 126.902], ['서대문', 'seodaemun', 37.579, 126.937], ['서초', 'seocho', 37.484, 127.032], ['성동', 'seongdong', 37.563, 127.037], ['성북', 'seongbuk', 37.589, 127.017], ['송파', 'songpa', 37.515, 127.106], ['양천', 'yangcheon', 37.517, 126.866], ['영등포', 'yeongdeungpo', 37.526, 126.896], ['용산', 'yongsan', 37.532, 126.991], ['은평', 'eunpyeong', 37.603, 126.929], ['종로', 'jongno', 37.574, 126.979], ['중구', 'jung-gu', 37.564, 126.998], ['중랑', 'jungnang', 37.607, 127.093]],
  인천: [['부평', 'bupyeong', 37.507, 126.722], ['남동', 'namdong', 37.447, 126.731], ['연수', 'yeonsu', 37.410, 126.678], ['계양', 'gyeyang', 37.537, 126.738], ['서해', 'seohae', 37.533, 126.652], ['검단', 'geomdan', 37.598, 126.662], ['미추홀', 'michuhol', 37.464, 126.651], ['제물포', 'jemulpo', 37.474, 126.632], ['영종', 'yeongjong', 37.492, 126.530]],
  경기: [['수원', 'suwon', 37.264, 127.029], ['성남', 'seongnam', 37.420, 127.127], ['용인', 'yongin', 37.280, 127.120], ['고양', 'goyang', 37.658, 126.832], ['부천', 'bucheon', 37.503, 126.766], ['안양', 'anyang', 37.394, 126.957], ['안산', 'ansan', 37.322, 126.831], ['화성', 'hwaseong', 37.200, 126.980], ['평택', 'pyeongtaek', 36.992, 127.113], ['의정부', 'uijeongbu', 37.738, 127.034], ['남양주', 'namyangju', 37.636, 127.217], ['시흥', 'siheung', 37.380, 126.803], ['파주', 'paju', 37.760, 126.780], ['김포', 'gimpo', 37.615, 126.716], ['광명', 'gwangmyeong', 37.479, 126.865], ['군포', 'gunpo', 37.362, 126.935], ['하남', 'hanam', 37.539, 127.215], ['오산', 'osan', 37.150, 127.077], ['이천', 'icheon', 37.272, 127.435], ['안성', 'anseong', 37.008, 127.280], ['구리', 'guri', 37.594, 127.130], ['의왕', 'uiwang', 37.345, 126.968], ['양주', 'yangju', 37.785, 127.046], ['포천', 'pocheon', 37.895, 127.200], ['동두천', 'dongducheon', 37.904, 127.061], ['과천', 'gwacheon', 37.429, 126.988], ['여주', 'yeoju', 37.298, 127.637], ['양평', 'yangpyeong', 37.492, 127.488], ['가평', 'gapyeong', 37.832, 127.511], ['경기광주', 'gwangju', 37.429, 127.255]],
};
const BOARD_NAME = { guest: '게스트', pickup: '픽업게임', match: '연습경기·교류전' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a, b = [광역, 동네, 슬러그, 위도, 경도]
const km = (a, b) => { const R = 6371, t = x => x * Math.PI / 180; const h = Math.sin(t(b[3] - a[3]) / 2) ** 2 + Math.cos(t(a[3])) * Math.cos(t(b[3])) * Math.sin(t(b[4] - a[4]) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
export const unent = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#34|#39);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#34': '"', '#39': "'" }[k]));
const where = p => p.region2 ? label(p.region1, p.region2) : (p.region1 || '');
const label = (r1, d) => d === '경기광주' ? '경기 광주' : `${r1} ${d}`;
function dayLabel(ymd, today) {
  if (!ymd) return '날짜 미정';
  const [y, m, d] = ymd.split('-').map(Number), w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const t = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  return `${ymd === today ? '오늘 · ' : ymd === t ? '내일 · ' : ''}${m}/${d} (${w})`;
}

// 같은 글을 여러 번 올린 경우(같은 날짜·시작 시각·동네에 제목이 거의 같음) 지역 페이지에는 최신 1건만
function bigrams(t) { t = String(t).replace(/[\s\[\]()]/g, ''); const r = new Set(); for (let i = 0; i < t.length - 1; i++) r.add(t.slice(i, i + 2)); return r; }
function similar(a, b) { const A = bigrams(a), B = bigrams(b); let n = 0; A.forEach(x => B.has(x) && n++); return n / Math.max(1, Math.max(A.size, B.size)); }
function dedupe(rows) {
  const newest = [...rows].sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted)), drop = new Set();
  newest.forEach((p, i) => {
    if (drop.has(p.key) || !p.date || !p.start) return;
    for (const q of newest.slice(i + 1)) if (!drop.has(q.key) && q.date === p.date && q.start === p.start && (q.region2 || q.region1) === (p.region2 || p.region1) && similar(p.title, q.title) >= 0.85) drop.add(q.key);
  });
  return rows.filter(p => !drop.has(p.key));
}
const CAFE_NOTE = '<p class="cm">글을 누르면 카페 원문으로 가요. 원문은 카페 회원만 볼 수 있으니, 회원이 아니면 먼저 가입해 주세요: <a href="https://m.cafe.daum.net/dongarry" target="_blank" rel="noopener">[BDR]동아리농구방</a> · <a href="https://m.cafe.naver.com/cornrow" target="_blank" rel="noopener">NSB 농심카페</a></p>';
function page({ path, title, desc, h1, intro, posts, today, updated, crumbs, links, cta, home, trend = '', robots = '', empty = '', extra = '', place = null }) {
  const url = `${SITE}${path}`;
  const groups = new Map();
  for (const p of posts) { const k = p.date || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const list = posts.length ? [...groups].map(([d, ps]) => `<h2>${esc(dayLabel(d, today))} <small>${ps.length}건</small></h2><ul>${ps.map(p => `<li><span class="t">${esc(p.start || p.slot || '시간 미정')}</span><a href="${esc(p.url)}" rel="nofollow noopener" target="_blank">${esc(unent(p.title))}</a><span class="m">${home && p.region2 !== home ? `<b class="near">근처 ${esc(where(p))}</b> · ` : ''}${p.src === 'naver' ? '네이버 농심카페' : '다음 BDR 동아리농구방'} · ${BOARD_NAME[p.board] || '게스트'}</span></li>`).join('')}</ul>`).join('')
    : empty || '<p class="empty">지금은 모집 글이 없어요. 가까운 지역이나 전체 목록을 확인해 보세요.</p>';
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: '훕게스트', alternateName: ['hoopguest', '농구 게스트 모아보기'], url: SITE + '/' },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + u })) },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: h1, numberOfItems: posts.length, itemListElement: posts.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: unent(p.title), url: p.url })) }];
  if (place) ld.push({ '@context': 'https://schema.org', '@type': 'SportsActivityLocation', ...place });
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">${robots ? `<meta name="robots" content="${robots}">` : ''}
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="훕게스트">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png">
<meta name="theme-color" content="#CF3326"><link rel="icon" href="/ball.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>try{var t=JSON.parse(localStorage.getItem('bdr.theme')||'null');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}</script>
<style>
:root{--bg:#FFFDF6;--text:#0E0E10;--sub:#4E4E55;--line:#0E0E10;--accent:#C8161B;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--text:#F4F1E8;--sub:#B4B0A8;--line:#F4F1E8;--accent:#FF7A6E;--card:#1C1C20}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 "Noto Sans KR",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.w{max-width:720px;margin:0 auto;padding:0 16px 40px}
header{background:#E0201B;color:#fff;padding:18px 0 16px;border-bottom:3px solid #0E0E10}
header a{color:#fff;font-weight:700;text-decoration:none;display:inline-block;padding:4px 0}
nav.bc{font-size:13px;margin:14px 0 4px;color:var(--sub)} nav.bc a{color:var(--sub);display:inline-block;padding:4px 2px}
h1{font-size:24px;line-height:1.3;margin:6px 0 8px}
.intro{color:var(--sub);margin:0 0 14px}
.cta{display:inline-block;background:#C8161B;color:#fff;font-weight:700;padding:11px 16px;border:3px solid var(--line);text-decoration:none;box-shadow:4px 4px 0 var(--line);margin:4px 0 8px}
h2{font-size:17px;margin:24px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--line)} h2 small{font-size:13px;color:var(--sub);font-weight:500}
ul{list-style:none;margin:0;padding:0}
li{background:var(--card);border:2px solid var(--line);padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:auto 1fr;gap:2px 12px}
li .t{font-weight:700;grid-row:span 2;min-width:44px}
li a{color:var(--text);text-decoration:none;word-break:keep-all;overflow-wrap:anywhere} li a:hover{text-decoration:underline}
li .m{font-size:13px;color:var(--sub)} li .near{color:var(--text)}
.trend{margin-top:26px;padding:12px 14px;border:2px solid var(--line);background:var(--card)} .trend h2{margin-top:0;border:0;font-size:16px} .trend p{margin:0} .trend p+p{margin-top:8px;font-size:14px;color:var(--sub)} .trend p b{color:var(--text)} .trend a{color:var(--text);display:inline-block;padding:2px 0}
.mp{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px} .mp a{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);font-weight:700;text-decoration:none;font-size:14px}
.empty{padding:20px;border:2px dashed var(--line);background:var(--card)}
.cm{font-size:13px;color:var(--sub);margin:4px 0 0;line-height:1.6} .cm a{color:var(--text);font-weight:700}
.links{margin-top:28px} .links h2{font-size:15px} .links a{display:inline-block;margin:4px 10px 4px 0;color:var(--text)}
footer{font-size:13px;color:var(--sub);margin-top:28px;line-height:1.6}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}

/* 10-10 디자인 개편: 밝은 화면 = 정돈된 코트, 어두운 화면 = 야간 코트 (첫 화면과 같은 색, html[data-theme]로 고정 가능) */
:root{--bg:#F6F2EC;--text:#17181A;--sub:#5E5A53;--line:#E8E2D8;--accent:#B4231A;--card:#fff;--hero:#CF3326;--hero-text:#fff;--pill:#F1EEE8;--btn:#CF3326;--btn-text:#fff;--cs:0 1px 2px rgba(70,50,20,.05),0 3px 12px rgba(70,50,20,.06);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111316;--text:#F4F4F2;--sub:#A3A7AE;--line:#2A2E35;--accent:#FF8A33;--card:#1B1E23;--hero:#16181C;--hero-text:#F4F4F2;--pill:#262A30;--btn:#FF7A1A;--btn-text:#111316;--cs:none;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111316;--text:#F4F4F2;--sub:#A3A7AE;--line:#2A2E35;--accent:#FF8A33;--card:#1B1E23;--hero:#16181C;--hero-text:#F4F4F2;--pill:#262A30;--btn:#FF7A1A;--btn-text:#111316;--cs:none;color-scheme:dark}
body{background:var(--bg);color:var(--text)}
header{background:var(--hero);color:var(--hero-text);border-bottom:1px solid var(--line)}
header a{color:var(--hero-text);font-size:18px;font-weight:800;letter-spacing:-.01em}
h2{border-bottom:1px solid var(--line)}
.cta{background:var(--btn);color:var(--btn-text);border:0;border-radius:12px;box-shadow:none;transition:transform .12s ease}
.cta:active,.b:active{transform:scale(.98)}
li{border:1px solid var(--line);border-radius:18px;box-shadow:var(--cs,none)}
.trend{border:1px solid var(--line);border-radius:18px}
.empty{border:1px dashed var(--line);border-radius:18px}
.c{border:1px solid var(--line);border-radius:20px;box-shadow:var(--cs,none)}
.where{background:var(--pill);color:var(--text);border:0;border-radius:999px}
.x{border:1px dashed var(--line);border-radius:10px}
.b{border:1px solid var(--line);border-radius:12px;transition:transform .12s ease}
.b1{background:var(--btn);color:var(--btn-text);border-color:transparent;box-shadow:none}
.b2{background:var(--card);color:var(--text)}
.nv{border-top:1px dashed var(--line)}
.nv a{border:1px solid var(--line);border-radius:999px}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.cta,.b{transition:none}}
</style>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}let ng=0;try{ng=localStorage.getItem('bdr.noga')==='1'}catch(e){}if(!ng&&location.hostname==='hoopguest.kro.kr'){const s=document.createElement('script');s.async=1;s.src='https://www.googletagmanager.com/gtag/js?id=${GA_ID}';document.head.appendChild(s);gtag('js',new Date());gtag('config','${GA_ID}')}</script>
</head><body>
<header><div class="w" style="padding-bottom:0"><a href="/">🏀 훕게스트</a></div></header>
<main class="w">
<nav class="bc" aria-label="위치">${crumbs.map(([n, u], i) => i === crumbs.length - 1 ? esc(n) : `<a href="${u}">${esc(n)}</a> › `).join('')}</nav>
<h1>${esc(h1)}</h1>
<p class="intro">${esc(intro)}</p>
${extra}<a class="cta" href="${esc(cta)}">날짜·시간 필터로 보기 →</a>
${posts.length ? CAFE_NOTE : ''}${list}
${trend}
<section class="links">${links.map(([t, ls]) => `<h2>${esc(t)}</h2><p>${ls.map(([n, u]) => `<a href="${u}">${esc(n)}</a>`).join('')}</p>`).join('')}</section>
<footer>다음카페 [BDR]동아리농구방과 네이버 카페 NSB 농심카페(운영진 허락)의 공개 글 제목만 모아 30분마다 갱신하는 비공식 사이트입니다. 비용·장소·연락처는 원문에서 확인하세요. 마지막 갱신: ${esc(new Date(Date.parse(updated) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '))} (KST)</footer>
</main></body></html>`;
}


// 글 하나 공유용 페이지 /p/<키>/ — 카톡 등에 링크를 보내면 미리보기에 일시·동네가 보이게
export const postSlug = key => String(key).replace(/[^A-Za-z0-9]/g, '-');
// 제목 속 체육관 이름 → 지도 검색어 (docs/index.html의 placeOf와 같은 규칙. 고치면 둘 다 고칠 것)
export function placeOf(title, region2) {
  const t = String(title).replace(/&#\d+;|&[a-z]+;/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, m => /체육|센터|학교|관[\])]$|(중|고|초)[\])]$|짐/.test(m) ? ' ' + m.slice(1, -1) + ' ' : ' ').replace(/\s+/g, ' ');
  const SUF = '국민체육센터|문화체육센터|생활체육관|체육센터|체육관|스포츠센터|스포츠센타|레포츠센터|청소년센터|청소년수련관|수련관|복지관|행정복지센터|복지센터|문화센터|회관|체육공원|아레나|농구교실|농구장|초등학교|중학교|고등학교|대학교|YMCA|짐|GYM|\\d관';
  const re = new RegExp(`(?:([가-힣A-Za-z0-9]{2,})\\s)?([가-힣A-Za-z0-9]*(?:${SUF}))(?=에서|에|으로|로|[^가-힣A-Za-z0-9]|$)`, 'i');
  let m = t.match(re), p = null;
    // 카카오맵 전수 확인(10-10): 검색어를 고쳐야 하는 곳, 지도에 없는 곳(길찾기 숨김)
    if (/컨퍼런스\s*체육관|신설\s*체육관|위플레이|김포공항\s*체육관/.test(t)) return null;
    const fix = [[/마스터욱/, '마스터욱 바스켓볼센터'], [/가좌\s*국민체육센터/, '인천 가좌국민체육센터'], [/중구\s*청소년(수련관|센터)/, region2 === '중구' ? '서울 중구청소년센터' : null], [/SK\s*주니어/i, region2 === '남양주' || /별내/.test(t) ? 'SK주니어나이츠 노원별내점' : null]].find(([re]) => re.test(t));
    if (fix) return fix[1];
  if (m) {
    p = m[2];
    const bare = new RegExp(`^(${SUF})$`, 'i').test(p);
    const gen = /^(실내|보조|다목적|종합|대)?(체육관|체육센터)$/.test(p);
    if (gen && m[1] && /(학교|[가-힣]{2}(중|고|초))$/.test(m[1])) p = m[1]; // '보성여고 실내체육관' → 학교 이름으로 검색
    else if (bare || gen) p = m[1] && !/^\d/.test(m[1]) && m[1] !== region2 && !/^(국민|문화|생활|실내|보조|종합|다목적|구민|시민|청소년)$/.test(m[1]) && !(/^[가-힣]{1,3}(구|시|동)$/.test(m[1]) && !(/^[가-힣]{1,3}구$/.test(m[1]) && /^(국민|문화)체육센터$/.test(p))) && !/(역|인근|근처|주변)$/.test(m[1]) ? `${m[1]} ${p}` : null;
    else if (/^제?\d/.test(p) && m[1] && !/^\d|[시분]$/.test(m[1])) p = `${m[1]} ${p}`;
    if (p && /인근|근처|주변/.test(p)) p = null;
  }
  if (!p) { // '송례중', '선유중' 같은 학교 줄임말
    const s = t.match(/(?:^|\s|-)([가-힣]{2,4}(?:중|고|초))(?=\s|$|에서|으로|,|\.)/);
    if (s && !/(모집|구인|진행|구하는|최|가능|이|제)(중|고|초)$|^(오후|오전)/.test(s[1])) p = s[1];
  }
  if (!p) { // 제목에 '체육관' 같은 말 없이 이름만 쓰는 곳 (카카오맵으로 위치 확인한 곳만)
    const k = [[/스킬존/, '고양 스킬존'], [/원스포츠/, '하남 원스포츠아카데미'], [/농구연구소/, '인천 농구연구소'], [/(동백|용인)\s*kcc|kcc\s*(주니어|이지스)/i, 'KCC이지스주니어 용인점']].find(([re]) => re.test(t));
    if (k) return k[1];
  }
  if (!p) return null;
  p = p.replace(/^\d+/, '');
  if (p.length < 3) return null;
    p = p.replace(/(여)?(중|고|초)$/, (_, f, k) => (f ? '여자' : '') + { 중: '중학교', 고: '고등학교', 초: '초등학교' }[k]); // '동삭중'은 카카오맵에서 안 찾아져 정식 이름으로
  const r = /^(서해|검단|제물포|영종)$/.test(region2) ? '인천' : region2; // 새 구 이름은 카카오맵 검색어로 안 먹힘
    const q = r && !p.includes(r) && !/^(강남|강동|강북|강서|관악|광진|구로|금천|노원|도봉|동대문|동작|마포|서대문|서초|성동|성북|송파|양천|영등포|용산|은평|종로|중구|중랑|수원|성남|용인|고양|부천|안양|안산|화성|평택|의정부|남양주|시흥|파주|김포|광명|군포|하남|오산|이천|안성|구리|의왕|양주|포천|동두천|과천|여주|양평|가평|광주|인천|부평|남동|연수|계양|미추홀)/.test(p) ? `${r} ${p}` : p; // 이름이 다른 시·구로 시작하면(의왕부곡중 등) 앞에 붙이지 않음
  return q;
}

let PLACE_IDS = null; // 카카오 장소 확인 결과('검색어 → 장소 ID', places.mjs). null이면 확인 전 방식
export function setPlaceIds(m) { PLACE_IDS = m; }
const placeChecked = q => !q || !PLACE_IDS ? q : PLACE_IDS[q] ? q : null;
function postPage(p, today) {
  const path = `/p/${postSlug(p.key)}/`, url = `${SITE}${path}`;
  const t = unent(p.title);
  const abs = ymd => { const [y, m, d] = ymd.split('-').map(Number); return `${m}/${d} (${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; }; // 공유 미리보기는 '오늘·내일' 대신 날짜로
  const when = [p.date ? abs(p.date) : '날짜는 원문 확인', p.start ? `${p.start}${p.end ? '~' + p.end : ''}` : ''].filter(Boolean).join(' ');
  const place = where(p) || '지역은 원문 확인';
  const kind = BOARD_NAME[p.board] || '게스트';
  const src = p.src === 'naver' ? '네이버 농심카페' : '다음 BDR 동아리농구방';
  // 미리보기 제목: 모르는 항목은 빼고 아는 것만 (예: '🏀 13:00~16:00 · 서울 강서 게스트 모집')
  const known = [p.date ? abs(p.date) : '', p.start ? `${p.start}${p.end ? '~' + p.end : ''}` : ''].filter(Boolean).join(' ');
  const ogTitle = `🏀 ${[known, where(p)].filter(Boolean).join(' · ')} ${kind} 모집`.replace(/\s+/g, ' ');
  const desc = `${t} — ${src} 글이에요. 훕게스트에서 수도권 농구 게스트·픽업게임·교류전 모집 글을 한눈에 모아봐요.`;
  const q = new URLSearchParams();
  if (p.region1) q.set('r', p.region1);
  if (p.region2) q.set('r2', p.region2);
  if (p.date && p.date >= today && !p.closed) q.set('d', p.date); // 마감 글은 날짜까지 좁히면 0건이 되기 쉬워 지역만
  if (p.board && p.board !== 'guest') q.set('b', p.board);
  const more = `/?${q}`;
  const spot = !p.closed && !(p.date && p.date < today) ? placeChecked(placeOf(t, p.region2)) : null;
  const navHtml = spot ? `<div class="nv"><span>📍 ${esc(spot)} 길찾기</span><a href="${PLACE_IDS && PLACE_IDS[spot] ? `https://map.kakao.com/link/to/${PLACE_IDS[spot]}` : `https://map.kakao.com/link/search/${encodeURIComponent(spot)}`}" target="_blank" rel="noopener" data-app="kakao">카카오맵<span class="sr"> (새 창)</span></a><a href="https://map.naver.com/p/search/${encodeURIComponent(spot)}" target="_blank" rel="noopener" data-app="naver">네이버 지도<span class="sr"> (새 창)</span></a></div><script>document.querySelectorAll('.nv a').forEach(function(a){a.addEventListener('click',function(){gtag('event','directions',{post_id:${JSON.stringify(p.key)},app:a.dataset.app,from:'share'})})})</script>` : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ogTitle)} | 훕게스트</title>
<meta name="description" content="${esc(desc)}"><meta name="robots" content="noindex,follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="훕게스트">
<meta property="og:title" content="${esc(ogTitle)}"><meta property="og:description" content="${esc(t)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#CF3326"><link rel="icon" href="/ball.svg" type="image/svg+xml">
<script>try{var t=JSON.parse(localStorage.getItem('bdr.theme')||'null');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}</script>
<style>
:root{--bg:#FFFDF6;--text:#0E0E10;--sub:#4E4E55;--line:#0E0E10;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--text:#F4F1E8;--sub:#B4B0A8;--line:#F4F1E8;--card:#1C1C20}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 "Noto Sans KR",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.w{max-width:560px;margin:0 auto;padding:0 16px 40px}
header{background:#E0201B;color:#fff;padding:16px 0;border-bottom:3px solid #0E0E10}
header a{color:#fff;font-weight:700;text-decoration:none;display:inline-block;padding:4px 0}
.c{margin:20px 0 14px;background:var(--card);border:3px solid var(--line);box-shadow:5px 5px 0 var(--line);padding:16px}
.when{font-size:22px;font-weight:800;line-height:1.3}
.where{display:inline-block;margin:8px 0 10px;background:#FFE14D;color:#0E0E10;font-weight:700;font-size:14px;padding:2px 8px;border:2px solid #0E0E10}
.t{font-size:16px;word-break:keep-all;overflow-wrap:anywhere;margin:0 0 6px}
.m{font-size:13px;color:var(--sub)}
.x{margin:0 0 10px;padding:6px 10px;border:2px dashed var(--line);font-weight:700}
.b{display:block;text-align:center;font-weight:700;padding:13px 16px;border:3px solid var(--line);text-decoration:none;margin:10px 0}
.b1{background:#C8161B;color:#fff;box-shadow:4px 4px 0 var(--line)}
.b2{background:var(--card);color:var(--text)}
p.f{font-size:13px;color:var(--sub);margin-top:22px;line-height:1.6}
.cm{font-size:13px;color:var(--sub);margin:-2px 0 12px;line-height:1.6}
.cm a{color:var(--text);font-weight:700}
a:focus-visible{outline:3px solid #E0201B;outline-offset:2px}
.nv{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;padding-top:12px;border-top:2px dashed var(--line);font-size:14px}
.nv>span{font-weight:700;flex-basis:100%}
.nv a{display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border:2px solid var(--line);color:var(--text);font-weight:700;text-decoration:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* 10-10 디자인 개편: 밝은 화면 = 정돈된 코트, 어두운 화면 = 야간 코트 (첫 화면과 같은 색, html[data-theme]로 고정 가능) */
:root{--bg:#F6F2EC;--text:#17181A;--sub:#5E5A53;--line:#E8E2D8;--accent:#B4231A;--card:#fff;--hero:#CF3326;--hero-text:#fff;--pill:#F1EEE8;--btn:#CF3326;--btn-text:#fff;--cs:0 1px 2px rgba(70,50,20,.05),0 3px 12px rgba(70,50,20,.06);color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111316;--text:#F4F4F2;--sub:#A3A7AE;--line:#2A2E35;--accent:#FF8A33;--card:#1B1E23;--hero:#16181C;--hero-text:#F4F4F2;--pill:#262A30;--btn:#FF7A1A;--btn-text:#111316;--cs:none;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111316;--text:#F4F4F2;--sub:#A3A7AE;--line:#2A2E35;--accent:#FF8A33;--card:#1B1E23;--hero:#16181C;--hero-text:#F4F4F2;--pill:#262A30;--btn:#FF7A1A;--btn-text:#111316;--cs:none;color-scheme:dark}
body{background:var(--bg);color:var(--text)}
header{background:var(--hero);color:var(--hero-text);border-bottom:1px solid var(--line)}
header a{color:var(--hero-text);font-size:18px;font-weight:800;letter-spacing:-.01em}
h2{border-bottom:1px solid var(--line)}
.cta{background:var(--btn);color:var(--btn-text);border:0;border-radius:12px;box-shadow:none;transition:transform .12s ease}
.cta:active,.b:active{transform:scale(.98)}
li{border:1px solid var(--line);border-radius:18px;box-shadow:var(--cs,none)}
.trend{border:1px solid var(--line);border-radius:18px}
.empty{border:1px dashed var(--line);border-radius:18px}
.c{border:1px solid var(--line);border-radius:20px;box-shadow:var(--cs,none)}
.where{background:var(--pill);color:var(--text);border:0;border-radius:999px}
.x{border:1px dashed var(--line);border-radius:10px}
.b{border:1px solid var(--line);border-radius:12px;transition:transform .12s ease}
.b1{background:var(--btn);color:var(--btn-text);border-color:transparent;box-shadow:none}
.b2{background:var(--card);color:var(--text)}
.nv{border-top:1px dashed var(--line)}
.nv a{border:1px solid var(--line);border-radius:999px}
a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.cta,.b{transition:none}}
</style>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}let ng=0;try{ng=localStorage.getItem('bdr.noga')==='1'}catch(e){}if(!ng&&location.hostname==='hoopguest.kro.kr'){const s=document.createElement('script');s.async=1;s.src='https://www.googletagmanager.com/gtag/js?id=${GA_ID}';document.head.appendChild(s);gtag('js',new Date());gtag('config','${GA_ID}');gtag('event','shared_post_view',{post_id:'${esc(p.key)}'})}</script>
</head><body>
<header><div class="w" style="padding-bottom:0"><a href="/">🏀 훕게스트</a></div></header>
<main class="w">
<div class="c">
${p.closed ? '<p class="x">마감됐다고 표시된 글이에요. 아래에서 다른 글을 찾아보세요.</p>' : p.date && p.date < today ? '<p class="x">지난 일정이에요. 아래에서 다른 글을 찾아보세요.</p>' : ''}<p class="x" id="over" hidden></p><div class="when">${esc(when)}</div>
<span class="where">${esc(place)} · ${esc(kind)}</span>
<p class="t">${esc(t)}</p>
<div class="m">${esc(src)} 글 · 비용·장소·연락처는 원문에서 확인하세요</div>
${navHtml}</div>
<a class="b b1" id="go" href="${esc(p.url)}" rel="nofollow noopener">${p.closed || (p.date && p.date < today) ? '카페 원문 보기' : '카페 원문 보고 신청하기 →'}</a>
${p.src === 'naver' ? '<p class="cm">원문은 네이버 카페 NSB 농심카페 회원만 볼 수 있어요. 회원이 아니면 <a href="https://m.cafe.naver.com/cornrow" rel="noopener">카페에 먼저 가입</a>해 주세요.</p>' : '<p class="cm">원문은 다음 카페 [BDR]동아리농구방 회원만 볼 수 있어요. 회원이 아니면 <a href="https://m.cafe.daum.net/dongarry" rel="noopener">카페에 먼저 가입</a>해 주세요.</p>'}
<a class="b b2" href="${esc(more)}">${esc(p.region2 ? place : p.region1 || '수도권')} 다른 모집 글 더 보기</a>
<script>(function(){var d=${JSON.stringify(p.date || '')},s=${JSON.stringify(p.start || '')},e=${JSON.stringify(p.end || '')};if(!d||!s||${p.closed || (p.date && p.date < today) ? 'true' : 'false'})return;function t(hm,add){var a=d.split('-').map(Number),b=hm.split(':').map(Number);return Date.UTC(a[0],a[1]-1,a[2],b[0]+(add||0),b[1])-324e5;}var st=t(s),en=e?t(e,e<s?24:0):st+72e5,n=Date.now(),o=document.getElementById('over');if(n>=en){o.textContent='이미 끝난 일정이에요. 아래에서 다른 글을 찾아보세요.';o.hidden=false;document.getElementById('go').textContent='카페 원문 보기';}else if(n>=st){o.textContent='이미 시작한 일정이에요. 늦참이 되는지 원문에서 확인하세요.';o.hidden=false;}})();</script>
<p class="f">훕게스트는 다음카페 [BDR]동아리농구방과 네이버 NSB 농심카페(운영진 허락)의 농구 게스트·픽업게임·교류전 모집 글 제목을 모아 30분마다 갱신하는 비공식 사이트예요. 지역·날짜·시간대로 골라 보고, 새 글 알림도 받을 수 있어요.</p>
</main></body></html>`;
}

// 제목 속 장소 이름 (체육관·센터 등) — 지역 페이지 '자주 나온 장소'용
const VENUE = /([가-힣A-Za-z]{2,12}(?:다목적체육관|국민체육센터|문화체육센터|체육관|체육센터|스포츠센터|레포츠센터|청소년수련관))/;
export function venueOf(title) {
  const t = unent(title).replace(/\d+\s*(시|분|반)?|에서|부터|까지|[~\-:().,\[\]/]/g, ' ');
  const m = t.match(VENUE);
  if (!m) return null;
  const v = m[1].replace(/^(오전|오후|저녁|아침|새벽|밤|팀)/, '');
  return /^(인근|근처|주변)/.test(v) || v.length < 4 ? null : v;
}
const SLOT_WORD = { 오전: '오전', 오후: '오후', 저녁: '저녁' };
// 누적 기록 갱신: 글 키별로 지역·요일·시간대·장소만 남기고, 최근 28일만 유지
async function updateHistory(posts, today) {
  let h = {};
  try { h = JSON.parse(await readFile(HIST, 'utf8')); } catch {}
  const since = h._since || today; delete h._since;
  for (const p of posts) {
    if (!p.key || !p.region1) continue;
    const d = p.date || String(p.posted || '').slice(0, 10);
    if (!d) continue;
    const q = placeOf(unent(p.title), p.region2) || '', prev = h[p.key];
    // id = 카카오 장소 ID(확인된 곳만, 체육관 페이지 묶음 기준). 이번에 확인 못 했으면 예전에 확인한 값 유지
    const id = q && PLACE_IDS && PLACE_IDS[q] ? String(PLACE_IDS[q]) : prev && prev.q === q ? prev.id || '' : '';
    h[p.key] = { r1: p.region1, r2: p.region2 || '', d, s: p.slot || '', b: p.board || 'guest', v: venueOf(p.title) || '', q, id };
  }
  const cut = new Date(Date.parse(today + 'T00:00:00Z') - 28 * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(h)) if (h[k].d < cut) delete h[k];
  await mkdir(new URL('.', HIST), { recursive: true });
  const rows = Object.values(h);
  await writeFile(HIST, JSON.stringify({ _since: since, ...h }));
  rows.since = since;
  return rows;
}
// 지역 '최근 경향' 문단 (글이 3건 이상 쌓였을 때만)
const hasBatchim = w => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 > 0; };
const iga = w => w + (hasBatchim(w) ? '이' : '가');
const ieyo = w => w + (hasBatchim(w) ? '이에요' : '예요');
const top = (arr, n) => Object.entries(arr.reduce((m, x) => (x && (m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, n);
// gyms: 체육관 페이지 연결용 [{id, path, name}] — 경향 문단의 '자주 열리는 장소'를 그 페이지로 링크
function trendHtml(rows, name, today, since, gyms = [], noVenue = false) {
  if (rows.length < 3) return '';
  const days = Math.max(1, Math.min(28, Math.round((Date.parse(today) - Date.parse(since || today)) / 864e5) + 1));
  const span = days >= 7 ? `최근 ${days}일` : '최근 모은 글';
  const wd = top(rows.map(r => WEEK[new Date(r.d + 'T00:00:00Z').getUTCDay()]), 2).map(([k]) => k + '요일');
  const sl = top(rows.map(r => SLOT_WORD[r.s]), 1).map(([k]) => k);
  const kinds = top(rows.map(r => BOARD_NAME[r.b]), 3).map(([k, n]) => `${k} ${n}건`).join(', ');
  // 요일·시간대별 건수 (그 지역만의 숫자라 페이지마다 내용이 달라짐)
  const byWd = WEEK.map((w, i) => [w, rows.filter(r => new Date(r.d + 'T00:00:00Z').getUTCDay() === i).length]);
  const bySl = ['오전', '오후', '저녁'].map(s => [s, rows.filter(r => r.s === s).length]).filter(([, n]) => n);
  const weekend = byWd[0][1] + byWd[6][1];
  // 자주 열리는 장소: 체육관 페이지가 있으면 링크, 없으면 제목에서 찾은 장소 이름
  const gq = new Map(gyms.map(g => [g.id, g]));
  // 장소 이름 앞의 지역명 떼기('구로항동생활체육관' → '항동생활체육관')해서 같은 곳을 한 줄로
  const vn = v => { if (!v) return ''; for (const n of R_NAMES) if (v.startsWith(n) && v.length - n.length >= 4 && !/^(구민|구청|시민|군민|종합|국민|문화|생활|다목적|실내|청소년|체육)/.test(v.slice(n.length))) return v.slice(n.length); return v; };
  const gv = new Map(); gyms.forEach(g => { gv.set(vn(g.name.replace(/\s/g, '')), g); g.rows.forEach(r => r.v && gv.set(vn(r.v), g)); });
  const vc = new Map();
  for (const r of rows) { const v = vn(r.v); const g = (r.id && gq.get(r.id)) || (v && gv.get(v)); const k = g ? g.path : v; if (!k) continue; const e = vc.get(k) || { n: 0, g, v }; e.n++; vc.set(k, e); }
  const vs = [...vc.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const vHtml = vs.length && !noVenue ? `<p><b>자주 열리는 장소</b> ${vs.map(e => e.g ? `<a href="${e.g.path}">${esc(e.g.name)}</a> ${e.n}건` : `${esc(e.v)} ${e.n}건`).join(' · ')}</p>` : '';
  return `<section class="trend"><h2>${esc(name)} 농구 모집 경향</h2><p>${span} 기준 ${esc(name)} 농구 모집 글은 ${rows.length}건(${esc(kinds)})이에요.${wd.length ? ` 요일은 ${esc(iga(wd.join('·')))} 가장 많았고` : ''}${sl.length ? `${wd.length ? ',' : ''} 시간대는 ${esc(iga(sl[0]))} 가장 많았어요.` : wd.length ? '요.' : ''} 주말(토·일) 글은 ${weekend}건으로 전체의 ${Math.round(weekend / rows.length * 100)}%예요.</p>
<p><b>요일별</b> ${byWd.map(([w, n]) => `${w} ${n}`).join(' · ')}${bySl.length ? `<br><b>시간대별</b> ${bySl.map(([s, n]) => `${s} ${n}건`).join(' · ')}` : ''}</p>${vHtml}</section>`;
}
// 첫 화면(docs/index.html)에 오늘·내일 글 목록을 미리 심어 둠 — 검색 로봇이 스크립트 없이도 내용을 읽도록
function ssrList(live, today) {
  const rows = live.filter(p => p.date && p.date >= today).slice(0, 80);
  if (!rows.length) return '<p class="ssr-empty">지금은 모집 글이 없어요.</p>';
  const groups = new Map();
  for (const p of rows) { if (!groups.has(p.date)) groups.set(p.date, []); groups.get(p.date).push(p); }
  const r2url = p => { const s1 = R1[p.region1]; const d = s1 && (DISTRICTS[p.region1] || []).find(x => x[0] === p.region2); return d ? `/r/${s1}/${d[1]}/` : s1 ? `/r/${s1}/` : ''; };
  return [...groups].map(([d, ps]) => `<section class="ssr"><h2>${esc(dayLabel(d, '1970-01-01'))} 수도권 농구 게스트·픽업 모집 ${ps.length}건</h2><ul>${ps.map(p => { const u = r2url(p); const w = where(p); return `<li><b>${esc(p.start || p.slot || '시간 미정')}</b> ${w ? (u ? `<a href="${u}">${esc(w)}</a>` : esc(w)) : ''} ${esc(BOARD_NAME[p.board] || '게스트')} · <a href="${esc(p.url)}" rel="nofollow noopener" target="_blank">${esc(unent(p.title))}</a></li>`; }).join('')}</ul></section>`).join('');
}
const GYM_MIN = 5; // 체육관 페이지를 만드는 최소 글 수(최근 28일) — 얇은 페이지 방지
const R_NAMES = new Set(['서울', '인천', '경기', ...Object.values(DISTRICTS).flat().map(d => d[0])]);
// 기록(hist)의 카카오 장소 ID로 체육관 묶기. 이름은 가장 많이 쓴 검색어에서 앞의 지역명을 뺀 것
function gymList(hist, live) {
  const by = new Map();
  for (const r of hist) if (r.id) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
  const gyms = [];
  for (const [id, rows] of by) {
    if (rows.length < GYM_MIN) continue;
    const q = top(rows.map(r => r.q), 1)[0][0];
    const r1 = top(rows.map(r => r.r1), 1)[0][0], r2 = (top(rows.map(r => r.r2), 1)[0] || [''])[0];
    let name = q; const m = q.match(/^(\S+)\s+(.+)$/);
    if (m && R_NAMES.has(m[1])) name = m[2];
    if (!/^\d+$/.test(id)) continue;
    gyms.push({ id, q, qs: new Set(rows.map(r => r.q)), name, r1, r2, rows, path: `/g/${id}/` });
  }
  return gyms.sort((a, b) => b.rows.length - a.rows.length);
}
export async function buildPages(data) {
  const today = data.today, updated = data.updated;
  const live = dedupe(data.posts.filter(p => !p.closed && (p.date ? p.date >= today : (Date.parse(updated) - Date.parse(p.posted)) / 864e5 <= 2)))
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.start || '99').localeCompare(b.start || '99'));
  const ymdK = today.replace(/-/g, '.');
  const hist = await updateHistory(data.posts, today);
  const out = []; // [path, html]
  const all = Object.entries(DISTRICTS).flatMap(([r1, ds]) => ds.map(d => [r1, ...d]));
  const r1Links = Object.entries(R1).map(([r, s]) => [`${r} 농구 게스트`, `/r/${s}/`]);
  const gyms = gymList(hist, live);
  const dUrl = (r1, n) => { const d = (DISTRICTS[r1] || []).find(x => x[0] === n); return d ? `/r/${R1[r1]}/${d[1]}/` : R1[r1] ? `/r/${R1[r1]}/` : '/'; };
  for (const [r1, s1] of Object.entries(R1)) {
    const ps = live.filter(p => p.region1 === r1);
    const byD = DISTRICTS[r1].map(([n, s]) => [`${n === '경기광주' ? '광주' : n} (${ps.filter(p => p.region2 === n).length})`, `/r/${s1}/${s}/`]);
    out.push([`/r/${s1}/`, page({
      path: `/r/${s1}/`, today, updated,
      title: `${r1} 농구 게스트 모집 · 픽업게임 · 교류전 | 훕게스트`,
      desc: `${r1} 지역 농구 게스트 구인, 픽업게임, 연습경기·교류전 모집 글 ${ps.length}건을 날짜·시간순으로 모았어요. ${ymdK} 기준, 30분마다 갱신.`,
      h1: `${r1} 농구 게스트 · 픽업게임 · 교류전`,
      intro: `${r1} 지역에서 지금 올라온 농구 게스트 구함, 픽업게임, 연습경기 모집 글이에요. 제목을 누르면 카페 원문으로 이동해요.`,
      posts: ps, crumbs: [['홈', '/'], [`${r1}`, `/r/${s1}/`]],
      links: [[`${r1} 동네별`, byD], ['다른 지역', r1Links.filter(([, u]) => u !== `/r/${s1}/`)]],
      cta: `/?r=${encodeURIComponent(r1)}`,
      trend: trendHtml(hist.filter(h => h.r1 === r1), r1, today, hist.since, gyms),
    })]);
    for (const [n, s, la, lo] of DISTRICTS[r1]) {
      const me = [r1, n, s, la, lo];
      const near = all.filter(d => d[1] !== n).map(d => [d, km(me, d)]).sort((a, b) => a[1] - b[1]).slice(0, 8);
      const nearNames = new Set([n, ...near.slice(0, 5).map(([d]) => d[1])]);
      const mine = live.filter(p => p.region1 === r1 && p.region2 === n);
      const nearRank = new Map(near.map(([d], i) => [d[1], i]));
      // 근처 글은 가까운 동네 순(같은 거리면 날짜순) — 이웃 페이지마다 보여 주는 글이 달라지게
      const nearby = live.filter(p => p.region2 && nearNames.has(p.region2) && !(p.region1 === r1 && p.region2 === n))
        .map((p, i) => [p, i]).sort((x, y) => (nearRank.get(x[0].region2) ?? 99) - (nearRank.get(y[0].region2) ?? 99) || x[1] - y[1]).map(([p]) => p);
      const nm = label(r1, n);
      const hRows = hist.filter(h => h.r1 === r1 && h.r2 === n);
      // 자기 지역 글이 지금 없고 최근 28일 기록도 3건 미만이면 근처 글만 보여 주는 얇은 페이지 → 검색 노출 안 함(사이트맵·RSS 제외)
      const thin = !mine.length && hRows.length < 3;
      const gymLinks = gyms.filter(g => g.r1 === r1 && g.r2 === n).map(g => [g.name, g.path]);
      out.push([`/r/${s1}/${s}/`, page({ robots: thin ? 'noindex,follow' : '',
        path: `/r/${s1}/${s}/`, today, updated,
        title: `${nm} 농구 게스트 모집 · 픽업게임 · 교류전 | 훕게스트`,
        desc: `${nm} 농구 게스트 구함·픽업게임·교류전 모집 글을 날짜·시간순으로 모아봐요.${mine.length ? ` 지금 ${mine.length}건` : ''}${mine.length < 3 && nearby.length ? `${mine.length ? ',' : ' 지금'} 근처 지역 ${Math.min(nearby.length, 10)}건` : ''}. 30분마다 갱신.`,
        h1: `${nm} 농구 게스트 · 픽업게임`,
        intro: mine.length >= 3 ? `${nm}에서 지금 모집 중인 농구 게스트·픽업게임·교류전 글 ${mine.length}건이에요.` : mine.length ? `${nm} 글 ${mine.length}건과 가까운 지역 글을 함께 보여 드려요.` : `${nm}에는 지금 모집 글이 없어요. 가까운 지역 글을 대신 보여 드려요.`,
        posts: mine.length >= 3 ? mine : [...mine, ...nearby.slice(0, 10).sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || (x.start || '99').localeCompare(y.start || '99'))], // 근처 글은 10건까지만(이웃 지역 페이지끼리 내용이 겹치지 않게)
        crumbs: [['홈', '/'], [r1, `/r/${s1}/`], [nm, `/r/${s1}/${s}/`]],
        links: [...(gymLinks.length ? [[`${nm} 체육관별 모집`, gymLinks]] : []), ['가까운 지역', near.map(([d]) => [label(d[0], d[1]), `/r/${R1[d[0]]}/${d[2]}/`])], ['광역 지역', r1Links]],
        cta: `/?r=${encodeURIComponent('내 근처')}&h=${encodeURIComponent(n)}&km=10`, home: n,
        trend: trendHtml(hRows, nm, today, hist.since, gyms),
      }), thin]);
    }
  }
  // 체육관별 페이지 /g/<카카오 장소 ID>/ — 최근 28일 글이 GYM_MIN건 이상인 확인된 장소만
  for (const g of gyms) {
    const area = g.r2 ? label(g.r1, g.r2) : g.r1;
    const mine = live.filter(p => g.qs.has(placeOf(unent(p.title), p.region2) || ''));
    const others = gyms.filter(x => x !== g && x.r1 === g.r1 && x.r2 === g.r2).map(x => [x.name, x.path]);
    const reg = dUrl(g.r1, g.r2);
    out.push([g.path, page({
      path: g.path, today, updated,
      title: `${g.name} 농구 게스트 · 픽업게임 (${area}) | 훕게스트`,
      desc: `${area} ${g.name}에서 열리는 농구 게스트 구함·픽업게임·교류전 모집 글을 모아봐요. 최근 28일 ${g.rows.length}건${mine.length ? `, 지금 ${mine.length}건 모집 중` : ''}. 30분마다 갱신.`,
      h1: `${g.name} 농구 게스트 · 픽업게임`,
      intro: `${area} ${g.name}에서 열리는 농구 게스트·픽업게임·교류전 모집 글이에요. 최근 28일 동안 ${g.rows.length}건이 올라왔어요.`,
      posts: mine,
      empty: `<p class="empty">지금 ${esc(g.name)} 모집 글은 없어요. <a href="${reg}">${esc(area)} 전체 모집 글</a>을 확인해 보세요.</p>`,
      extra: `<div class="mp"><a href="https://map.kakao.com/link/to/${g.id}" target="_blank" rel="noopener">카카오맵 길찾기</a><a href="https://map.naver.com/p/search/${encodeURIComponent(g.q)}" target="_blank" rel="noopener">네이버 지도</a></div>`,
      place: { name: g.name, url: SITE + g.path, hasMap: `https://map.kakao.com/link/map/${g.id}`, sport: 'Basketball', containedInPlace: { '@type': 'AdministrativeArea', name: area } },
      crumbs: [['홈', '/'], [g.r1, `/r/${R1[g.r1]}/`], ...(g.r2 ? [[area, reg]] : []), [g.name, g.path]],
      links: [...(others.length ? [[`${area} 다른 체육관`, others]] : []), [`${area} 농구 게스트`, [[`${area} 전체 모집 글`, reg]]], ['광역 지역', r1Links]],
      cta: g.r2 ? `/?r=${encodeURIComponent('내 근처')}&h=${encodeURIComponent(g.r2)}&km=10` : `/?r=${encodeURIComponent(g.r1)}`, home: g.r2,
      trend: trendHtml(g.rows, g.name, today, hist.since, [], true),
    })]);
  }
  await rm(new URL('r/', DOCS), { recursive: true, force: true });
  await rm(new URL('g/', DOCS), { recursive: true, force: true });
  // 글별 공유 페이지 (검색 노출 안 함, 사이트맵 제외)
  await rm(new URL('p/', DOCS), { recursive: true, force: true });
  for (const p of data.posts) {
    if (!p.key) continue;
    const dir = new URL(`p/${postSlug(p.key)}/`, DOCS);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('index.html', dir), postPage(p, today));
  }
  for (const [path, html] of out) {
    const dir = new URL('.' + path, DOCS);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('index.html', dir), html);
  }
  const lastmod = updated.slice(0, 10);
  // lastmod: 페이지 내용(갱신 시각 문구 제외)이 실제로 바뀐 날만 기록 — 매번 모든 페이지를 오늘로 찍으면 검색엔진이 lastmod를 믿지 않음
  let lm = {};
  try { lm = JSON.parse(await readFile(LASTMOD, 'utf8')); } catch {}
  const lmNext = {};
  for (const [p, html] of out) {
    const h = createHash('sha1').update(html.replace(/마지막 갱신: [^<]*/, '').replace(/"numberOfItems":\d+/, '')).digest('hex').slice(0, 12);
    lmNext[p] = lm[p] && lm[p][0] === h ? lm[p] : [h, lastmod];
  }
  await mkdir(new URL('.', LASTMOD), { recursive: true });
  await writeFile(LASTMOD, JSON.stringify(lmNext));
  const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${lastmod}</lastmod></url>\n${out.filter(([, , thin]) => !thin).map(([p]) => `  <url><loc>${SITE}${p}</loc><lastmod>${lmNext[p][1]}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(new URL('sitemap.xml', DOCS), sm);
  // RSS: 오늘 모집 글이 있는 지역 페이지 목록 (네이버 서치어드바이저 RSS 제출용)
  const pub = new Date(updated).toUTCString();
  const items = [[`훕게스트 — 오늘 수도권 농구 모집 ${live.filter(p => p.date === today).length}건`, '/', '서울·경기·인천 농구 게스트·픽업게임·교류전 모집 글 모아보기']];
  for (const [r1, s1] of Object.entries(R1)) for (const [n, s] of DISTRICTS[r1]) {
    const k = live.filter(p => p.region1 === r1 && p.region2 === n).length;
    if (k) items.push([`${label(r1, n)} 농구 게스트 모집 ${k}건 (${ymdK})`, `/r/${s1}/${s}/`, `${label(r1, n)} 농구 게스트 구함·픽업게임·교류전 모집 글 ${k}건`]);
  }
  const rss = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>훕게스트 — 수도권 농구 게스트 모아보기</title><link>${SITE}/</link><description>서울·경기·인천 농구 게스트 구함·픽업게임·교류전 모집 글을 지역·날짜·시간대별로 모아봐요</description><language>ko</language><lastBuildDate>${pub}</lastBuildDate>\n${items.map(([t, u, d]) => `<item><title>${esc(t)}</title><link>${SITE}${u}</link><guid isPermaLink="false">${SITE}${u}#${today}</guid><description>${esc(d)}</description><pubDate>${pub}</pubDate></item>`).join('\n')}\n</channel></rss>\n`;
  await writeFile(new URL('rss.xml', DOCS), rss);
  // 첫 화면에 글 목록 심기 (<!--ssr--> … <!--/ssr--> 사이만 교체)
  try {
    const idxUrl = new URL('index.html', DOCS);
    const idx = await readFile(idxUrl, 'utf8');
    const a = idx.indexOf('<!--ssr-->'), b = idx.indexOf('<!--/ssr-->');
    if (a > 0 && b > a) await writeFile(idxUrl, idx.slice(0, a + 10) + ssrList(live, today) + idx.slice(b));
  } catch {}
  // 마이페이지(/my/)는 첫 화면과 같은 코드를 씀 — 매번 복사(글 목록은 비우고 검색 노출 안 함)
  try {
    const { mkdir } = await import('node:fs/promises');
    const cur = await readFile(new URL('index.html', DOCS), 'utf8');
    const a = cur.indexOf('<!--ssr-->'), b = cur.indexOf('<!--/ssr-->');
    let my = a > 0 && b > a ? cur.slice(0, a + 10) + cur.slice(b) : cur;
    my = my.replace(/<title>[^<]*<\/title>/, '<title>마이페이지 · 훕게스트</title>').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">');
    await mkdir(new URL('my/', DOCS), { recursive: true });
    await writeFile(new URL('my/index.html', DOCS), my);
  } catch {}
  return out.length;
}
