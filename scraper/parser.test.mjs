// 파서 회귀 테스트 — 실제 수집 제목 1,800여 개의 시각·시간대 판정이 바뀌면 실패한다.
//   node --test scraper/parser.test.mjs   (GitHub Actions smoke에서도 실행)
// 파서를 일부러 고쳐서 결과가 바뀌는 게 맞다면: node scraper/parser.test.mjs --update 로 기대값을 다시 만들고, 바뀐 줄을 확인한 뒤 커밋한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parsePost, kstYmd } from './parser.mjs';

const FILE = new URL('./parser-cases.json', import.meta.url);
const cases = JSON.parse(readFileSync(FILE, 'utf8'));
const run = c => { const r = parsePost(c.t, c.h || '', kstYmd(c.p)); return { s: r.start ?? null, e: r.end ?? null, l: r.slot ?? null, a: r.amb ? 1 : 0 }; };

if (process.argv.includes('--update')) {
  const out = cases.map(c => { const r = run(c); const o = { t: c.t, p: c.p, s: r.s, e: r.e, l: r.l }; if (c.h) o.h = c.h; if (r.a) o.a = 1; return o; });
  let changed = 0; out.forEach((o, i) => { const c = cases[i]; if (o.s !== c.s || o.e !== c.e || o.l !== c.l || !!o.a !== !!c.a) { changed++; console.log(`${c.s}-${c.e}${c.a ? '?' : ''} → ${o.s}-${o.e}${o.a ? '?' : ''} | ${c.t.slice(0, 60)}`); } });
  writeFileSync(FILE, '[\n' + out.map(x => JSON.stringify(x)).join(',\n') + '\n]\n');
  console.log(`기대값 갱신: ${changed}건 바뀜 / ${out.length}건`);
} else {
  test('제목별 시각·시간대가 기대값과 같다', () => {
    const diff = [];
    for (const c of cases) {
      const r = run(c);
      if (r.s !== (c.s ?? null) || r.e !== (c.e ?? null) || r.l !== (c.l ?? null) || r.a !== (c.a ? 1 : 0))
        diff.push(`기대 ${c.s}-${c.e}${c.a ? '?' : ''}(${c.l}) / 실제 ${r.s}-${r.e}${r.a ? '?' : ''}(${r.l}) | ${c.t.slice(0, 70)}`);
    }
    assert.equal(diff.length, 0, `바뀐 결과 ${diff.length}건:\n` + diff.slice(0, 30).join('\n'));
  });
  test('저녁·밤·pm 단서가 있는데 오전으로 읽은 글이 없다', () => {
    const bad = cases.filter(c => c.s && +c.s.slice(0, 2) < 12 && /저녁|밤|야간|(?<![a-z])pm(?![a-z])/i.test(c.t) && !/오전|아침|새벽|(?<![a-z])am(?![a-z])|낮/i.test(c.t));
    assert.equal(bad.length, 0, bad.map(c => `${c.s} | ${c.t.slice(0, 70)}`).join('\n'));
  });
  test('오후·pm이 시각 바로 앞에 붙은 글을 오전으로 읽지 않는다', () => {
    const cs = [['[서울] 10월 28일 (수) 7pm-9:30 게스트', '19:00'], ['[하남] 오늘 저녁 10월 27일 (화)9:00-11:30 게스트', '21:00'], ['[서울] 신도림 팀 CHAMP 에서 27일 화요일 7ㅡ10 게스트', '07:00']];
    for (const [t, s] of cs) assert.equal(parsePost(t, '', '2026-10-26').start, s, t);
    assert.ok(parsePost(cs[2][0], '', '2026-10-26').amb, "'7ㅡ10' 평일은 오전·저녁? 표시");
  });
}
