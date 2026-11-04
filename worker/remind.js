// 저장 글 리마인더 + 알림 구독 보호 — D1 "DB" (KV는 쓰지 않음)
// 테이블(account.js dbInit에서 자동 생성):
//  - reminders(sh, k, title, start_at, due_at, sent_at, dlv_at, tries)  sh = 구독 해시, k = 글 키, 시각은 ms
//      cron: due_at<=now AND start_at>now AND sent_at IS NULL AND dlv_at IS NULL 한 쿼리로 '보냄' 표시와 동시에 가져옴
//      /sub-state: 푸시 직후 15분 안에만 dlv_at 표시하며 돌려줌 → 같은 글 두 번 안 뜸, 제3자 소비 방지
//  - rl(k, win, n, at)        : 횟수 제한 (구독 등록 접속지별, /remind 구독별·접속지별)
//  - kvdel(sid)               : 탈퇴로 지울 기기 구독 KV 키 대기열(한 번에 못 지운 나머지를 cron이 이어서 삭제)
//  자동 삭제는 푸시 서비스가 404·410(없는 구독)이라고 답한 경우뿐 — 연속 실패 횟수로 지우는 경로는 없음
// D1은 한 곳(주 DB)에서 순서대로 처리돼 KV처럼 지역 간 반영 지연·인덱스 키 경합이 없다
import { dbInit } from './account.js';
// 무료 D1: 하루 쓰기 10만 행·읽기 500만 행, 한 번 실행당 쿼리 50회(batch는 1회로 셈) — 쓰기는 문장을 모아 batch로

export const REMIND_BEFORE = 2 * 3600e3;   // 시작 2시간 전 알림
export const DELIVER_WINDOW = 15 * 60e3;   // 푸시 후 이 시간 안에만 /sub-state가 리마인더를 넘겨줌
export const LATE_WINDOW = 6 * 3600e3;     // 푸시 TTL(6시간) — 늦게 깨어난 기기에는 제목 없이 '곧 시작' 안내만
export const MAX_AHEAD = 30 * 864e5;       // 30일 넘게 먼 글은 거부
export const REMIND_D1_DAY = 30000;        // /remind 전체 하루 D1 쓰기 행 상한
export const REMIND_D1_DAY_IP = 5000;      // 같은 접속지(/64·/48) 하루 상한
const KST = 9 * 3600e3;

const kstParts = t => { const s = new Date(t + KST).toISOString(); return { date: s.slice(0, 10), start: s.slice(11, 16) }; };
// 제어문자·방향 제어 문자 제거, 공백 정리, 80자(코드포인트 기준)
// 짝 없는 서로게이트(깨진 이모지 반쪽)도 제거 — D1·JSON에서 깨진 문자가 되지 않게
export const cleanTitle = s => typeof s === 'string'
  ? Array.from(s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 80).join('')
  : '';

// 클라이언트 항목 {key,title,date,start,url} → {k,title,start_at,due_at}. url은 받지 않음(저장 안 함)
export function cleanItems(items, now) {
  const out = [], seen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const { key, date, start } = it;
    if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{1,60}$/.test(key) || seen.has(key)) continue;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) continue; // 시각 없는 글은 리마인더 불가
    const [y, m, d] = date.split('-').map(Number), [hh, mm] = start.split(':').map(Number);
    const u = Date.UTC(y, m - 1, d, hh, mm), c = new Date(u);
    if (c.getUTCFullYear() !== y || c.getUTCMonth() !== m - 1 || c.getUTCDate() !== d) continue; // 02-30 같은 없는 날짜
    const t = u - KST;
    if (t <= now || t > now + MAX_AHEAD) continue; // 이미 시작했거나 30일 넘게 먼 글
    seen.add(key);
    out.push({ k: key, title: cleanTitle(it.title), start_at: t, due_at: t - REMIND_BEFORE });
  }
  return out;
}

// 고정 창 횟수 제한 — 규칙 여러 개를 '전부 통과할 때만' 기록 (거절된 요청은 읽기 1회만, 쓰기 0)
// rules: [{ k, ms(창 길이), max, cost }]. 한도 넘으면 true
// 기록은 키마다 조건부 upsert 한 문장(INSERT … ON CONFLICT DO UPDATE … WHERE 합계<=max RETURNING n)이라 동시 요청에도 max를 넘지 않음
export async function limitAll(env, rules, now = Date.now()) {
  if (rules.some(r => r.cost > r.max)) return true;
  const ks = rules.map(r => r.k);
  const { results } = await env.DB.prepare(`SELECT k, win, n FROM rl WHERE k IN (${ks.map(() => '?').join(',')})`).bind(...ks).all();
  const cur = new Map((results || []).map(x => [x.k, x]));
  for (const r of rules) { const w = Math.floor(now / r.ms), c = cur.get(r.k); if ((c && c.win === w ? c.n : 0) + r.cost > r.max) return true; }
  const res = await env.DB.batch(rules.map(r => env.DB.prepare(
    `INSERT INTO rl (k, win, n, at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN rl.win = excluded.win THEN rl.n + excluded.n ELSE excluded.n END, win = excluded.win, at = excluded.at
     WHERE (CASE WHEN rl.win = excluded.win THEN rl.n ELSE 0 END) + excluded.n <= ?5 RETURNING n`,
  ).bind(r.k, Math.floor(now / r.ms), r.cost, now, r.max)));
  if (res.every(x => (x.results || []).length)) return false;
  // 경합으로 하나라도 넘었으면 이번에 올린 것을 되돌리고 거절
  const undo = rules.filter((r, i) => (res[i].results || []).length)
    .map(r => env.DB.prepare('UPDATE rl SET n = n - ? WHERE k = ? AND win = ?').bind(r.cost, r.k, Math.floor(now / r.ms)));
  if (undo.length) await env.DB.batch(undo).catch(() => {});
  return true;
}
export const limited = (env, k, ms, max, cost = 1, now = Date.now()) => limitAll(env, [{ k, ms, max, cost }], now);

// /remind 본문 처리. 목록이 지금과 같으면 쓰기 0. 반환: { n } 또는 { error, status }
export async function replaceReminders(env, sh, items, ip, now = Date.now()) {
  await dbInit(env);
  const list = cleanItems(items, now);
  const { results } = await env.DB.prepare('SELECT k, title, start_at FROM reminders WHERE sh = ? AND start_at > ?').bind(sh, now).all();
  const old = new Map((results || []).map(r => [r.k, r]));
  const want = new Set(list.map(x => x.k));
  const changed = list.filter(x => { const o = old.get(x.k); return !o || o.title !== x.title || o.start_at !== x.start_at; });
  const removed = [...old.keys()].filter(k => !want.has(k));
  if (!changed.length && !removed.length) return { n: list.length, same: true };
  // D1 쓰기 예산 — 실제 D1 쓴 행 기준으로 셈: 리마인더 1행 = 3행(표 + 기본키 인덱스 + 부분 인덱스), 횟수 기록 규칙 1개 = 1행
  //  같은 구독 분당 10회·시간당 요청 30회·글 300건, 같은 접속지(/64) 시간당 글 600건, 전체 하루 D1 30,000행(무료 10만의 30%)
  const rows = changed.length + removed.length;
  const rules = [{ k: 'rm:' + sh, ms: 60e3, max: 10, cost: 1 }, { k: 'rq:' + sh, ms: 3600e3, max: 30, cost: 1 }, { k: 'rh:' + sh, ms: 3600e3, max: 300, cost: rows }];
  if (ip) rules.push({ k: 'ri:' + ip.ih, ms: 3600e3, max: 600, cost: rows });
  if (ip && ip.ih48) rules.push({ k: 'ri48:' + ip.ih48, ms: 3600e3, max: 1500, cost: rows });
  // 하루 D1 행 상한: 전체(rg) + 한 접속지가 전체를 혼자 채우지 못하게 /64(rgi)·/48(rg48) 따로(전체의 1/6)
  const day = [{ k: 'rg', ms: 864e5, max: REMIND_D1_DAY }];
  if (ip) day.push({ k: 'rgi:' + ip.ih, ms: 864e5, max: REMIND_D1_DAY_IP });
  if (ip && ip.ih48) day.push({ k: 'rg48:' + ip.ih48, ms: 864e5, max: REMIND_D1_DAY_IP });
  // D1 실제 쓴 행: 리마인더 1건 3행(표·기본키·부분 인덱스) + 횟수 기록 1개 2행(표·기본키 인덱스)
  const d1rows = rows * 3 + 2 * (rules.length + day.length);
  for (const d of day) rules.push({ ...d, cost: d1rows });
  if (await limitAll(env, rules, now)) return { error: 'too many', status: 429 };
  const st = [];
  if (removed.length) st.push(env.DB.prepare(`DELETE FROM reminders WHERE sh = ? AND k IN (${removed.map(() => '?').join(',')})`).bind(sh, ...removed));
  // 시작 시각이 그대로면 보냄·전달 표시 유지(다시 저장해도 중복 알림 없음), 바뀌면 새 글처럼 다시 알림
  for (const x of changed) st.push(env.DB.prepare(
    `INSERT INTO reminders (sh, k, title, start_at, due_at, sent_at, dlv_at, tries) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0)
     ON CONFLICT(sh, k) DO UPDATE SET title = excluded.title,
       sent_at = CASE WHEN reminders.start_at = excluded.start_at THEN reminders.sent_at END,
       dlv_at = CASE WHEN reminders.start_at = excluded.start_at THEN reminders.dlv_at END,
       tries = CASE WHEN reminders.start_at = excluded.start_at THEN reminders.tries ELSE 0 END,
       start_at = excluded.start_at, due_at = excluded.due_at`).bind(sh, x.k, x.title, x.start_at, x.due_at));
  await env.DB.batch(st); // 한 트랜잭션
  return { n: list.length };
}

// cron 리마인더 (H3: 예산 안에서 실제로 보낼 구독만 '보냄' 표시)
// 1) 때가 된 구독 후보를 이른 순으로 최대 limit개 (쓰기 없음)
export async function dueCandidates(env, now, limit) {
  await dbInit(env);
  const { results } = await env.DB.prepare(
    'SELECT sh, MIN(due_at) AS d FROM reminders WHERE due_at <= ? AND start_at > ? AND sent_at IS NULL AND dlv_at IS NULL GROUP BY sh ORDER BY d LIMIT ?',
  ).bind(now, now, limit).all();
  return (results || []).map(r => r.sh);
}
// 2) 실제로 보낼 구독만 '보냄' 표시하며 가져옴 — 조건부 UPDATE라 cron이 겹쳐도 한 번만 → [{sh, k, tries}]
export async function claimDue(env, shs, now) {
  if (!shs.length) return [];
  const { results } = await env.DB.prepare(
    `UPDATE reminders SET sent_at = ? WHERE sh IN (${shs.map(() => '?').join(',')}) AND due_at <= ? AND start_at > ? AND sent_at IS NULL AND dlv_at IS NULL RETURNING sh, k, tries`,
  ).bind(now, ...shs, now, now).all();
  return results || [];
}
// KV에 구독이 '확실히 없음'(오류 아님)일 때: 지우지 않고 한 번 미룸, 두 번째면 포기 표시 — 삭제는 시작+1일 정리가 함
export const missingSubStmt = (env, sh, now) => env.DB.prepare(
  'UPDATE reminders SET tries = tries + 1, sent_at = CASE WHEN tries >= 1 THEN ? END WHERE sh = ? AND due_at <= ? AND start_at > ? AND sent_at IS NULL AND dlv_at IS NULL',
).bind(now, sh, now, now);
// 레거시 이름(테스트 호환): 후보 전부를 바로 표시
export async function takeCronDue(env, now) { return claimDue(env, await dueCandidates(env, now, 1000), now); }
// 푸시 실패(404·410 외): 첫 실패면 표시를 되돌려 다음 cron에 한 번 더(재시도 최대 1회), 두 번째 실패면 포기
export const resetSentStmt = (env, sh, sentAt) =>
  env.DB.prepare('UPDATE reminders SET sent_at = NULL, tries = tries + 1 WHERE sh = ? AND sent_at = ? AND tries = 0 AND dlv_at IS NULL').bind(sh, sentAt);
export async function resetSent(env, sh, sentAt) { await resetSentStmt(env, sh, sentAt).run(); }

// /sub-state: 서버가 이 구독에 리마인더 푸시를 보낸 지 15분 안인 글만 넘기며 전달(dlv) 표시 → 같은 글 두 번 안 뜸,
//             endpoint를 아는 제3자가 아무 때나 불러 본인 알림을 없애지 못함
// 반환 { due:[{key,title,date,start}], late:[…], rp:bool }
//   late = 보낸 지 15분~6시간(푸시 TTL) 지났는데 아직 안 뜬 글 — 표시하지 않고(소비 안 함) 넘김. 서비스워커가 기기에서 한 번만 띄움
//   rp   = 15분 안에 이 구독에 리마인더 푸시를 보냈음(누가 이미 받아 감) → 서비스워커가 빈 '새 글' 알림을 띄우지 않게
// 테스트 표시(meta 'test:<sh>' = '<보낸 시각>' 또는 '<보낸 시각>:u'(이미 기기가 받아 감)) — 같은 batch라 쿼리 추가 없음, 행 없으면 쓰기 0
//  test: 아직 안 받아 간 표시이고 보낸 지 6분 안(테스트 푸시 TTL 5분 + 여유) → 받아 가며 ':u'로 표시
//  tp  : 최근 1시간 안에 테스트를 보냈음(받아 갔든 아니든) → 늦게 도착한 테스트 푸시·먼저 깬 다른 푸시 때문에 빈 '새 글' 알림이 뜨지 않게
//  행은 매시 정리에서 1시간 지나면 삭제(TP_WINDOW와 같은 기준)
export const TEST_WINDOW = 360e3, TP_WINDOW = 3600e3;
export async function takeDue(env, sh, now = Date.now()) {
  await dbInit(env);
  const [a, b, c0, c] = await env.DB.batch([
    env.DB.prepare('UPDATE reminders SET dlv_at = ? WHERE sh = ? AND sent_at >= ? AND dlv_at IS NULL AND start_at > ? RETURNING k, title, start_at')
      .bind(now, sh, now - DELIVER_WINDOW, now),
    env.DB.prepare('SELECT k, title, start_at, sent_at FROM reminders WHERE sh = ? AND sent_at >= ? AND dlv_at IS NULL AND start_at > ?')
      .bind(sh, now - LATE_WINDOW, now),
    env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind('test:' + sh),
    env.DB.prepare("UPDATE meta SET v = v || ':u' WHERE k = ? AND instr(v, ':') = 0 AND CAST(v AS INTEGER) >= ? RETURNING v").bind('test:' + sh, now - TEST_WINDOW),
  ]);
  const test = (c.results || []).length > 0;
  const tp = (c0.results || []).some(r => now - parseInt(r.v, 10) < TP_WINDOW);
  const out = rows => rows.sort((x, y) => x.start_at - y.start_at).map(r => ({ key: r.k, title: r.title, ...kstParts(r.start_at) }));
  const due = out(a.results || []);
  const late = out((b.results || []).filter(r => r.sent_at < now - DELIVER_WINDOW));
  let rp = due.length > 0;
  if (!rp) rp = !!(await env.DB.prepare('SELECT 1 AS x FROM reminders WHERE sh = ? AND sent_at >= ? LIMIT 1').bind(sh, now - DELIVER_WINDOW).first());
  return { due, late, rp, test, tp };
}


// 구독이 확실히 없어졌을 때(푸시 서비스 404·410, 사용자 해지) D1 쪽 정리 문장 — 리마인더·계정 연결
export const dropStmts = (env, sh) => [
  env.DB.prepare('DELETE FROM reminders WHERE sh = ?').bind(sh),
  env.DB.prepare('DELETE FROM devices WHERE sid = ?').bind('sub:' + sh),
];
// 문장 여러 개를 나눠 batch (batch 1번 = D1 쿼리 1회)
export async function runStmts(env, st) {
  for (let i = 0; i < st.length; i += 80) await env.DB.batch(st.slice(i, i + 80));
}

// ---- cron 동시 실행 방지(lease) · 새 글 알림 라운드로빈 상태 — meta 테이블 1행씩 ----
export async function acquireLease(env, now, ms = 240e3) {
  await dbInit(env);
  const tok = `${now + ms}:${Math.random().toString(36).slice(2, 10)}`;
  const r = await env.DB.prepare(
    "INSERT INTO meta (k, v) VALUES ('lease', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(substr(meta.v, 1, instr(meta.v, ':') - 1) AS INTEGER) < ?2 RETURNING v",
  ).bind(tok, now).first();
  return r ? tok : false;
}
export const releaseLeaseStmt = (env, tok) => env.DB.prepare("DELETE FROM meta WHERE k = 'lease' AND v = ?").bind(tok);
// rr = { g: 마지막으로 처리한 구독 해시, rounds: [{ start, wrapped, posts:[…] }] } — 예산 때문에 다음 cron으로 넘긴 새 글 알림
export async function loadRR(env) {
  await dbInit(env);
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'rr'").first();
  try { const x = r ? JSON.parse(r.v) : null; if (x && typeof x === 'object') return x; } catch {}
  return { g: '', rounds: [] };
}
export const saveRRStmt = (env, rr) => (rr.rounds && rr.rounds.length) || rr.g || (rr.sent && Object.keys(rr.sent).length)
  ? env.DB.prepare("INSERT INTO meta (k, v) VALUES ('rr', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(rr))
  : env.DB.prepare("DELETE FROM meta WHERE k = 'rr'");

// 매시 1회 정리: 시작 후 1일 지난 리마인더, 지난 횟수 제한 기록 + 탈퇴 대기열의 기기 구독 KV 삭제(최대 300개씩)
export async function cleanupD1(env, now) {
  await dbInit(env);
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM reminders WHERE start_at < ?').bind(now - 864e5),
    // 횟수 기록: 창은 모두 하루 이하라 마지막 기록 후 하루 지나면 그 창은 끝났음 → 창 끝 뒤 최대 하루(+정리 주기 1시간) 안에 삭제
    env.DB.prepare('DELETE FROM rl WHERE at < ?').bind(now - 864e5),
    env.DB.prepare('DROP TABLE IF EXISTS subips'), // 이전 버전이 쓰던 IP 해시 표(더는 안 씀) — 남은 기록 삭제
    env.DB.prepare("DELETE FROM meta WHERE k LIKE 'test:%' AND CAST(v AS INTEGER) < ?").bind(now - 3600e3), // 테스트 표시: 1시간(TP_WINDOW) 지나면 삭제
  ]);
  const kv = await drainKvDel(env, 300);
  return [...r.map(x => x.meta?.changes ?? 0), kv];
}
// 탈퇴 대기열(kvdel)의 기기 구독 KV 키를 지움 — KV 삭제가 성공한 것만 대기열에서 뺌
export async function drainKvDel(env, max) {
  if (!env.SUBS) return 0;
  const { results } = await env.DB.prepare('SELECT sid FROM kvdel LIMIT ?').bind(max).all();
  const done = [];
  for (const { sid } of results || []) { try { await env.SUBS.delete(sid); done.push(sid); } catch { break; } }
  for (let i = 0; i < done.length; i += 90) await env.DB.prepare(`DELETE FROM kvdel WHERE sid IN (${done.slice(i, i + 90).map(() => '?').join(',')})`).bind(...done.slice(i, i + 90)).run();
  return done.length;
}
