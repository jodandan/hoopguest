// BDR 동아리농구방 게시판 목록(제목) 수집 → docs/data.json
// 게스트 구인 · 픽업게임 · 연습경기. 본문·작성자·연락처는 수집하지 않음. Node 20+ (내장 fetch)
import { readFile, writeFile } from 'node:fs/promises';
import { parsePost, postedAt, kstYmd } from './parser.mjs';
import { buildPages, setPlaceIds } from './pages.mjs';
import { verifyPlaces } from './places.mjs';

const GRPID = 'IGaj';           // dongarry 카페 내부 ID
export const BOARDS = [
  { fld: 'Dilr', key: 'guest', name: '게스트 구인', pages: 8 },
  { fld: 'IVHA', key: 'pickup', name: '픽업게임', pages: 2 },
  { fld: 'MptT', key: 'match', name: '연습경기', pages: 3 },
];
const PAGE_SIZE = 50;
const DELAY_MS = 1500;          // 요청 간격
const OUT = new URL('../docs/data.json', import.meta.url);
const API = 'https://m.cafe.daum.net/api/v1/common-articles';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 네이버 카페 NSB 농심카페 '수도권 게스트' 게시판 (운영진 허락: 개인정보 비노출 조건)
// 게스트·픽업·연습경기가 한 게시판에 섞여 있어 제목으로 분류. 작성자 정보는 저장하지 않음
export const NAVER = { cafeId: 10586238, menuId: 34, pages: 3, name: '농심카페' };
const NAVER_API = `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${NAVER.cafeId}/menus/${NAVER.menuId}/articles`;

// 제목 속 연락처 가리기 (전화번호·카톡/오픈채팅 ID)
export function maskTitle(t) {
  return String(t)
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '010-****-****')
    .replace(/((?:카톡|카카오톡|오픈채팅|오톡|kakao)\s*(?:아이디|id|ID)?\s*[:：]?\s*)[A-Za-z0-9_.\-]{3,}/gi, '$1****');
}
// 모집 글이 아닌 것 (대관 양도·중고 거래·분실물) — 목록에서 제외
export const NON_RECRUIT = /양도|판매합니다|팝니다|삽니다|구매합니다|구해봅니다\s*\(중고\)|분실|습득/;
// 한 게시판에 섞인 글을 제목으로 게시판 분류
export function classify(title) {
  const t = title.replace(/\s+/g, '');
  if (/픽업/.test(t)) return 'pickup';
  if (!/게스트/.test(t) && /(교류전|연습경기|연습게임|초청팀|팀초청|한팀|상대팀|팀구합|팀모집|매칭)/.test(t)) return 'match';
  return 'guest';
}

async function fetchNaver(now) {
  const out = [];
  for (let page = 1; page <= NAVER.pages; page++) {
    const q = new URLSearchParams({ page, pageSize: 50, sortBy: 'TIME', viewType: 'L' });
    const res = await fetch(`${NAVER_API}?${q}`, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://m.cafe.naver.com/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} (naver page ${page})`);
    const json = await res.json();
    const list = (json.result?.articleList || []).filter(x => x.type === 'ARTICLE' && x.item && !x.item.blindArticle).map(x => x.item);
    if (!list.length) break;
    for (const a of list) {
      const posted = new Date(a.writeDateTimestamp).toISOString();
      const title = maskTitle(String(a.subject || '').trim());
      const head = String(a.headName || '').replace(/모임$/, '');
      out.push({
        key: `N${NAVER.menuId}:${a.articleId}`, id: a.articleId, src: 'naver', board: classify(title), title,
        url: `https://cafe.naver.com/cornrow/${a.articleId}`,
        posted, views: a.readCount ?? 0, head,
        ...parsePost(title, head, kstYmd(posted)),
      });
    }
    if ((now - list.at(-1).writeDateTimestamp) / 864e5 > 3) break;
    await sleep(DELAY_MS);
  }
  return out;
}

async function fetchPage(fld, page, afterBbsDepth) {
  const q = new URLSearchParams({ grpid: GRPID, fldid: fld, pageSize: PAGE_SIZE, targetPage: page });
  if (afterBbsDepth) q.set('afterBbsDepth', afterBbsDepth);
  const res = await fetch(`${API}?${q}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': `https://m.cafe.daum.net/dongarry/${fld}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${fld} page ${page})`);
  const json = await res.json();
  if (!Array.isArray(json.articles)) throw new Error(`unexpected response (${fld} page ${page})`);
  return json.articles;
}

async function loadPrev() {
  try {
    const d = JSON.parse(await readFile(OUT, 'utf8'));
    // 구버전 데이터(게시판 구분 없음)는 게스트 구인으로 간주
    d.posts = (d.posts || []).map(p => p.key ? p : { ...p, board: 'guest', key: `Dilr:${p.id}` });
    return d;
  } catch { return { posts: [] }; }
}

async function fetchBoard(b, now) {
  const raw = [];
  let depth = null;
  for (let p = 1; p <= b.pages; p++) {
    const arts = await fetchPage(b.fld, p, depth);
    if (!arts.length) break;
    raw.push(...arts);
    depth = arts.at(-1).bbsDepth;
    const last = postedAt(arts.at(-1).articleElapsedTime, now);
    if ((now - Date.parse(last)) / 864e5 > 3) break; // 게시 3일 지난 글이 나오면 중단
    await sleep(DELAY_MS);
  }
  return raw.filter(a => !a.isNotice && !a.hasParentArticle).map(a => {
    const posted = postedAt(a.articleElapsedTime, now);
    return {
      key: `${b.fld}:${a.dataid}`,
      id: a.dataid,
      board: b.key,
      title: maskTitle(a.title.trim()),
      url: `https://m.cafe.daum.net/dongarry/${b.fld}/${a.dataid}`,
      posted,
      views: a.viewCount,
      head: a.headCont || '',
      ...parsePost(maskTitle(a.title), a.headCont, kstYmd(posted)),
    };
  });
}

async function main() {
  const now = Date.now();
  const today = kstYmd(new Date(now).toISOString());
  const prev = await loadPrev();
  const prevKeys = new Set(prev.posts.map(p => p.key));

  let kept = prev.posts;
  const fresh = [];
  const log = [];
  for (const b of BOARDS) {
    let got;
    try { got = await fetchBoard(b, now); }
    catch (e) { log.push(`${b.key}: 실패(${e.message}) — 기존 유지`); continue; }
    fresh.push(...got);
    // 삭제 감지: 이번에 훑은 id 범위 안인데 목록에 없으면 카페에서 삭제된 글 (응답이 적으면 보류)
    if (got.length >= 10) {
      const ids = new Set(got.map(p => p.id));
      const minId = Math.min(...ids);
      const before = kept.length;
      kept = kept.filter(p => !(p.key.startsWith(b.fld + ':') && p.id >= minId && !ids.has(p.id)));
      log.push(`${b.key}: ${got.length}건, 삭제 ${before - kept.length}`);
    } else log.push(`${b.key}: ${got.length}건`);
    await sleep(DELAY_MS);
  }
  try {
    const got = await fetchNaver(now);
    fresh.push(...got);
    const pre = `N${NAVER.menuId}:`;
    if (got.length >= 10) {
      const ids = new Set(got.map(p => p.id)), minId = Math.min(...ids), before = kept.length;
      kept = kept.filter(p => !(p.key.startsWith(pre) && p.id >= minId && !ids.has(p.id)));
      log.push(`naver: ${got.length}건, 삭제 ${before - kept.length}`);
    } else log.push(`naver: ${got.length}건`);
  } catch (e) { log.push(`naver: 실패(${e.message}) — 기존 유지`); }
  if (!fresh.length) throw new Error('수집 0건 — 기존 data.json 유지');

  // 병합: 새로 받은 글 우선, 이전 글은 게시시각 유지
  // 이전 글도 매번 최신 분석 규칙으로 다시 분석 (분석기 개선이 기존 글에도 반영되도록)
  kept = kept.map(p => {
    p = { ...p, title: maskTitle(p.title) };
    if (p.src === 'naver') p.board = classify(p.title);
    const n = parsePost(p.title, p.head || '', kstYmd(p.posted));
    if (p.head === undefined && !n.region1) { n.region1 = p.region1; n.region2 = p.region2; } // 말머리 저장 전 글은 기존 지역 유지
    return { ...p, ...n };
  });
  const byKey = new Map(kept.map(p => [p.key, p]));
  for (const p of fresh) {
    const old = byKey.get(p.key);
    byKey.set(p.key, old ? { ...p, posted: old.posted } : p);
  }

  const yesterday = kstYmd(new Date(now - 864e5).toISOString());
  const posts = [...byKey.values()]
    .filter(p => p.date ? p.date >= yesterday : (now - Date.parse(p.posted)) / 864e5 <= 3)
    .sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted) || b.id - a.id);

  // 같은 게시판에서 같은 제목 재게시는 최신 1건만
  const seen = new Set();
  const dedup = posts.filter(p => !NON_RECRUIT.test(p.title)).filter(p => {
    const k = p.board + p.title.replace(/\s+/g, '');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  const added = dedup.filter(p => !prevKeys.has(p.key)).map(p => p.key);
  const out = {
    updated: new Date(now).toISOString(), today,
    boards: BOARDS.map(({ fld, key, name }) => ({ fld, key, name, url: `https://m.cafe.daum.net/dongarry/${fld}` })),
    sources: [{ key: 'daum', name: 'BDR 동아리농구방', url: 'https://m.cafe.daum.net/dongarry' }, { key: 'naver', name: NAVER.name, url: `https://m.cafe.naver.com/ca-fe/web/cafes/${NAVER.cafeId}/menus/${NAVER.menuId}` }],
    added, posts: dedup,
  };
  await writeFile(OUT, JSON.stringify(out));
  setPlaceIds(await verifyPlaces(dedup, today).catch(e => { console.error('places:', e.message); return null; }));
  const pages = await buildPages(out);
  console.log(log.join(' / '), `| saved=${dedup.length} added=${added.length} pages=${pages}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
