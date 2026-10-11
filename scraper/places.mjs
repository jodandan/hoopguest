// 길찾기 장소 자동 확인 — 수집할 때마다 지금 모집 중인 글의 길찾기 검색어를 카카오 로컬 API(키워드로 장소 검색)로 실시간 확인한다.
// · 찾은 곳만 길찾기 버튼을 보여 주고, 카카오맵은 그 장소로 바로 길찾기(map.kakao.com/link/to/장소ID)
// · 카카오 운영 정책상 검색 결과(이름·주소·좌표)는 저장하지 않고 '검색어 → 장소 ID'만 docs/places.json에 남긴다
// · 키(GitHub Secrets의 KAKAO_REST_KEY)가 없거나 API가 응답하지 않으면 ids:null → 사이트는 확인 전 방식(검색 링크)으로 동작
import { writeFile } from 'node:fs/promises';
import { placeOf, unent } from './pages.mjs';

const OUT = new URL('../docs/places.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const METRO = /^(서울|경기|인천)/;

export async function verifyPlaces(posts, today) {
  const key = process.env.KAKAO_REST_KEY;
  let ids = null, note = '키 없음 — 확인 안 함';
  if (key) {
    const want = new Map(); // 검색어 → 글의 시·도
    for (const p of posts) {
      if (p.closed || (p.date && p.date < today)) continue;
      const q = placeOf(unent(p.title), p.region2);
      if (q && !want.has(q)) want.set(q, p.region1 || '');
    }
    const found = {}; let miss = 0, fail = 0;
    for (const [q, r1] of want) {
      try {
        const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=5&query=${encodeURIComponent(q)}`, { headers: { Authorization: `KakaoAK ${key}` } });
        if (!res.ok) { fail++; if ([401, 403, 429].includes(res.status)) { note = `API ${res.status}`; break; } continue; }
        const docs = (await res.json()).documents || [];
        const addr = d => String(d.road_address_name || d.address_name || '');
        const core = q.split(' ').pop().replace(/\s/g, '');
        // ① 글과 같은 시·도에 있는 첫 결과, ② 없으면 수도권이면서 이름에 검색어 핵심이 들어간 결과 (다른 지역의 엉뚱한 곳은 버림)
        const hit = docs.find(d => r1 && addr(d).startsWith(r1)) || docs.find(d => METRO.test(addr(d)) && String(d.place_name).replace(/\s/g, '').includes(core));
        if (hit) found[q] = String(hit.id); else miss++;
      } catch { fail++; }
      await sleep(100);
    }
    if (note.startsWith('API') || (fail && fail >= want.size / 2)) note = note.startsWith('API') ? `${note} — 확인 안 함` : `오류 ${fail}건 — 확인 안 함`;
    else { ids = found; note = `${want.size}곳 확인: 찾음 ${Object.keys(found).length}, 못 찾음 ${miss}, 오류 ${fail}`; }
  }
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), ids }));
  console.log(`places: ${note}`);
  return ids;
}
