// 게스트 구인 글 제목 → 지역/날짜/시간 구조화
// 브라우저·Node 공용 (의존성 없음)

export const REGION1 = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];

// 세부지역 사전: [표시명, 광역, 매칭 키워드...]
const DISTRICTS = [
  // 서울
  ['강남', '서울', '강남', '압구정', '청담', '수서', '삼성동', '대치', '역삼', '개포', '일원'],
  ['강동', '서울', '강동', '천호', '길동', '암사', '고덕', '둔촌'],
  ['강북', '서울', '강북', '수유', '미아', '북서울중', '번동'],
  ['강서', '서울', '강서', '마곡', '화곡', '발산', '등촌', '공항고', '공항동'],
  ['관악', '서울', '관악', '신림', '봉천', '서울대'],
  ['광진', '서울', '광진', '건대', '자양', '구의'],
  ['구로', '서울', '구로', '개봉', '오류', '고척', '신도림'],
  ['금천', '서울', '금천', '독산', '가산', '시흥동'],
  ['노원', '서울', '노원', '중계', '상계', '하계', '월계', '공릉'],
  ['도봉', '서울', '도봉', '창동', '방학', '쌍문'],
  ['동대문', '서울', '동대문', '토모짐', '장안', '청량리', '회기', '답십리', '용두'],
  ['동작', '서울', '동작', '상도', '노량진', '사당', '흑석', '대방', '신대방'],
  ['마포', '서울', '마포', '상암', '합정', '망원', '홍대', '공덕', '성산'],
  ['서대문', '서울', '서대문', '신촌', '연희', '홍제', '북가좌', '남가좌'],
  ['서초', '서울', '서초', '방배', '반포', '양재', '잠원', '내곡'],
  ['성동', '서울', '성동', '왕십리', '성수', '행당', '금호', '옥수'],
  ['성북', '서울', '성북', '석계', '길음', '정릉', '돈암', '종암', '장위', '월곡', '안암'],
  ['송파', '서울', '송파', '잠실', '문정', '가락', '방이', '오금', '거여', '마천', '위례'],
  ['양천', '서울', '양천', '목동', '신정', '신월'],
  ['영등포', '서울', '영등포', '여의도', '당산', '문래', '대림', '신길', '선유'],
  ['용산', '서울', '용산', '이촌', '이태원', '한남', '효창', '보성여고'],
  ['은평', '서울', '은평', '불광', '연신내', '응암', '녹번', '진관'],
  ['종로', '서울', '종로', '혜화', '평창동'],
  ['중구', '서울', '중구', '신당', '을지로', '충무로', '장충', '동대입구'],
  ['중랑', '서울', '중랑', '면목', '상봉', '망우', '묵동', '신내'],
  // 인천
  ['부평', '인천', '부평', '십정', '삼산', '갈산', '산곡'],
  ['남동', '인천', '남동', '구월', '논현', '간석', '만수', '소래'],
  ['연수', '인천', '연수', '송도'],
  ['계양', '인천', '계양', '작전', '계산'],
  // 2026-07 인천 행정체제 개편: 서구→서해구·검단구, 중구·동구→제물포구·영종구 (옛 이름도 새 구로 매칭)
  ['서해', '인천', '서해구', '청라', '가정동', '루원', '석남', '가좌', '인천서구', '인천 서구'],
  ['검단', '인천', '검단', '마전동', '당하동', '원당동', '마전역', '완정'],
  ['미추홀', '인천', '미추홀', '숭의', '주안', '용현', '학익'],
  ['제물포', '인천', '제물포', '신포', '동인천', '송림', '월미', '인천중구', '인천동구', '인천 중구', '인천 동구'],
  ['영종', '인천', '영종', '운서'],
  // 경기
  ['수원', '경기', '수원', '영통', '광교', '권선', '장안구', '팔달', '매탄'],
  ['성남', '경기', '성남', '분당', '판교', '정자', '서현', '야탑', '모란', '수정구', '중원구'],
  ['용인', '경기', '용인', '기흥', '수지', '죽전', '동백', '처인', '보정', '구성'],
  ['고양', '경기', '고양', '일산', '화정', '행신', '덕양', '삼송', '원흥', '킨텍스', '우장', '스킬존'],
  ['부천', '경기', '부천', '심원중', '중동', '상동', '송내', '역곡', '소사', '오정'],
  ['안양', '경기', '안양', '평촌', '범계', '인덕원', '정관장'],
  ['안산', '경기', '안산', '고잔', '초지', '상록', '단원'],
  ['화성', '경기', '화성', '동탄', '봉담', '병점', '향남'],
  ['평택', '경기', '평택', '고덕국제', '송탄'],
  ['의정부', '경기', '의정부', '민락'],
  ['남양주', '경기', '남양주', '별내', '다산', '호평', '평내', '진접', '오남'],
  ['시흥', '경기', '시흥', '배곧', '정왕', '은계', '신천역', '목감'],
  ['파주', '경기', '파주', '운정', '금촌', '교하'],
  ['김포', '경기', '김포', '장기', '구래', '풍무', '운양', '걸포', '감정동'],
  ['광명', '경기', '광명', '하안', '철산', '소하', '일직'],
  ['군포', '경기', '군포', '산본', '금정'],
  ['하남', '경기', '하남', '미사', '감일', '원스포츠'],
  ['오산', '경기', '오산', '세교'],
  ['이천', '경기', '이천'],
  ['안성', '경기', '안성'],
  ['구리', '경기', '구리', '갈매', '인창', '인사이드바스켓볼'],
  ['의왕', '경기', '의왕', '포일', '내손'],
  ['양주', '경기', '양주', '옥정', '덕정'],
  ['포천', '경기', '포천'],
  ['동두천', '경기', '동두천'],
  ['과천', '경기', '과천'],
  ['여주', '경기', '여주'],
  ['양평', '경기', '양평'],
  ['가평', '경기', '가평'],
  ['경기광주', '경기', '경기광주', '경기 광주', '광주시', '오포', '태전', '경안'],
];

// 긴 키워드 우선 매칭 (예: '동대문'이 '대문'보다, '서대문'이 먼저)
const KEYWORDS = DISTRICTS.flatMap(([name, r1, ...kws]) => kws.map(k => ({ k, name, r1 })))
  .sort((a, b) => b.k.length - a.k.length);

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// 날짜는 모두 "KST 자정 기준 UTC Date"로 다룸 (UTC 필드 = KST 날짜)
const mk = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

export function normalize(title) {
  return title
    .replace(/[ㅡ－]/g, '-')
    .replace(/[～〜]/g, '~')
    .replace(/(\d)\s*_\s*(?=\d)/g, '$1~') // '1900_22:00' → '1900~22:00'
    .replace(/(?<!\d)([01]\d|2[0-4])([0-5]\d)\s*([~\-])\s*([01]\d|2[0-4])([0-5]\d)(?!\d)/g, '$1:$2$3$4:$5')
    // 한쪽만 네 자리로 쓴 시각: '1930~22시', '9~1130', '1900~22:00'
    .replace(/(?<![\d:])([01]\d|2[0-4])([0-5]\d)(?=\s*[~\-]\s*\d{1,2}\s*(?::\s*\d{2}|시)(?!\d))/g, '$1:$2')
    .replace(/(?<=(?<![\d:])\d{1,2}(?:\s*:\s*\d{2}|\s*시)?\s*[~\-]\s*)([01]\d|2[0-4])([0-5]\d)(?![\d년])/g, '$1:$2')
    .replace(/(\d{1,2}\s*:\s*\d{2})\s*시(?!\s*\d)/g, '$1') // '16:30시' → '16:30'
    .replace(/(\d{1,2})\s*시\s*(\d{2})(?=\s*(?:~|-|부터))/g, '$1:$2')
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분\s+(\d{1,2})\s*시/g, '$1시$2분~$3시')
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*시/g, '$1시~$2시')
    .replace(/[＜〈<]/g, '<').replace(/[＞〉>]/g, '>')
    .replace(/[～〜]/g, '~').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim();
}

export function parseRegion(title, headCont) {
  const t = title.replace(/\s+/g, '');
  let r1 = headCont && REGION1.includes(headCont) ? headCont : null;
  // 제목 앞부분(12자 이내)에 광역명이 명시돼 있으면 말머리보다 우선 (예: 말머리 경기 + '[인천서구]')
  const lead = t.slice(0, 12).match(new RegExp(`(${REGION1.filter(r => r !== '광주').join('|')})`));
  if (lead) r1 = lead[1];
  const leadAt = lead ? lead.index : 99;
  let hit = null;
  for (const kw of KEYWORDS) {
    const k = kw.k.replace(/\s+/g, '');
    if (k.length < 2) continue;
    const i = t.indexOf(k);
    if (i < 0) continue;
    // '서울' 같은 광역명과 겹치는 오탐 방지: '중구'는 앞이 광역 없이 단독일 때만
    if (!hit || i < hit.i) hit = { ...kw, i };
  }
  if (!r1) {
    // 제목 앞쪽의 광역명 (광주는 세부지역 사전에서 경기광주 매칭 여부로 판단)
    const m = t.match(new RegExp(`(${REGION1.join('|')})`));
    if (m) r1 = m[1];
  }
  if (!r1 && hit) r1 = hit.r1;
  // '[부천, 인천]', '[김포/일산/인천]'처럼 앞에 먼저 나온 동네가 광역명보다 앞서면 동네를 우선
  if (hit && hit.i < leadAt && hit.i < 12 && hit.r1 !== r1) r1 = hit.r1;
  // 말머리 광역만 있고 제목에 광역명이 없는데 동네가 다른 광역이면 동네를 믿음 (예: 말머리 서울 + '[덕양구]')
  const titleR1 = new RegExp(`(${REGION1.filter(r => r !== '광주').join('|')})`).test(t);
  if (hit && r1 && hit.r1 !== r1 && r1 === headCont && !titleR1) r1 = hit.r1;
  // 광역이 명시됐는데 세부지역 광역이 다르면 세부지역 버림 (예: 광주광역시 vs 경기광주)
  let r2 = hit && (!r1 || hit.r1 === r1) ? hit.name : null;
  if (r1 === '광주' && headCont === '경기') { r1 = '경기'; r2 = '경기광주'; }
  if (r1 === '경기' && !r2 && /광주(?!광역)/.test(t)) r2 = '경기광주';
  return { region1: r1, region2: r2 };
}

// 날짜: posted(KST 날짜 Date) 기준으로 가장 그럴듯한 날짜
export function parseDate(title, posted) {
  const t = title;
  const py = posted.getUTCFullYear(), pm = posted.getUTCMonth() + 1, pd = posted.getUTCDate();
  const fix = (m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let dt = mk(py, m, d);
    // 게시일보다 60일 넘게 과거면 내년
    if ((posted - dt) / 864e5 > 60) dt = mk(py + 1, m, d);
    return dt;
  };
  let m, span = null, dt = null;
  // '26.10.01' / '2026.10.01' / '26-10-01' 처럼 연도가 붙은 숫자 날짜
  if ((m = t.match(/(?<![\d:])(?:20)?(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?![\d:])/)) && +m[2] >= 1 && +m[2] <= 12 && Math.abs(2000 + +m[1] - py) <= 1) { dt = mk(2000 + +m[1], +m[2], +m[3]); span = m[0]; }
  else if ((m = t.match(/(?:20\d{2}\s*[년.\-/]\s*)?(?<![\d/.:])(\d{1,2})\s*월\s*(\d{1,2})(?![\d:])\s*일?/)) && +m[1] <= 12) { dt = fix(+m[1], +m[2]); span = m[0]; }
  else if ((m = t.match(/(?<![\d:])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d:])\s*\.?\s*일?/)) && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) { dt = fix(+m[1], +m[2]); span = m[0]; }
  else if ((m = t.match(/(?<![\d:])(\d{1,2})\s*-\s*(\d{1,2})\s*일/))) { dt = fix(+m[1], +m[2]); span = m[0]; }
  else if ((m = t.match(/(?<![\d:~\-])(\d{1,2})\s*일(?!\s*[~\-])/))) {
    const d = +m[1];
    let mm = pm;
    if (d < pd - 3) mm = pm + 1;
    dt = mm > 12 ? mk(py + 1, 1, d) : mk(py, mm, d);
    span = m[0];
  } else if ((m = t.match(/(오늘|금일)/))) { dt = posted; span = m[0]; }
  else if ((m = t.match(/(내일|명일)/))) { dt = new Date(+posted + 864e5); span = m[0]; }
  else if ((m = t.match(/([월화수목금토일])요일/))) {
    const wd = WEEK.indexOf(m[1]);
    const diff = (wd - posted.getUTCDay() + 7) % 7;
    dt = new Date(+posted + diff * 864e5); span = m[0];
  }
  // 제목의 요일과 날짜가 안 맞으면 앞뒤 달 중 요일이 맞는 날로 보정 (예: 9/25 게시 '10/27(일)' → 9/27)
  const wm = t.match(/\(([월화수목금토일])\)|([월화수목금토일])요일/);
  if (dt && wm) {
    const want = WEEK.indexOf(wm[1] || wm[2]);
    if (dt.getUTCDay() !== want) {
      const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      const alt = [mo - 1, mo + 1].map(x => x < 1 ? mk(y - 1, 12, d) : x > 12 ? mk(y + 1, 1, d) : mk(y, x, d))
        .filter(x => x.getUTCDate() === d && x.getUTCDay() === want && (x - posted) / 864e5 >= -3 && (x - posted) / 864e5 <= 45);
      if (alt.length) dt = alt[0];
      else {
        // 앞뒤 달에도 없으면 ±2일 안에서 요일이 맞고 게시일 이후인 날 (예: 10/1 게시 '10월1일(토)' → 10/3)
        const near = [1, -1, 2, -2].map(k => new Date(+dt + k * 864e5))
          .filter(x => x.getUTCDay() === want && x - posted >= 0);
        if (near.length) dt = near[0];
      }
    }
  }
  return { date: dt ? ymd(dt) : null, span };
}

const PM = /(오후|저녁|밤|pm|PM)/;
const AM = /(오전|아침|새벽|am|AM)/;

function toMin(pref, h, mm) {
  h = +h; mm = +(mm || 0);
  if (h > 24 || mm > 59) return null;
  if (pref && PM.test(pref) && h < 12) h += 12;
  else if (pref && /낮/.test(pref) && h >= 1 && h <= 6) h += 12; // '낮1시' → 13시
  else if (pref && /새벽/.test(pref) && h === 12) h = 0; // '오전 12시'는 정오로 봄
  return h * 60 + mm;
}

const PREF = '(오전|오후|저녁|아침|새벽|밤|낮|am|pm|AM|PM)?\\s*';
const HM = '(\\d{1,2})\\s*(?::\\s*(\\d{2})|시\\s*(?:(\\d{1,2})\\s*분|(반))?)?';

export function parseTime(title, dateSpan, wdNum = null) {
  let t = title;
  if (dateSpan) t = t.replace(dateSpan, ' § ');
  // 날짜 바로 뒤에 '22 24'처럼 시각 두 개만 띄어 쓴 경우 → '22~24시'
  t = t.replace(/§\s*((?:\(?[월화수목금토일](?:요일)?\)?\s*)?)(\d{1,2})\s+(\d{1,2})(?![\d:시명분])/, (all, w, a, b) => {
    const d = +b - +a;
    return +a >= 5 && +a <= 23 && +b <= 24 && d >= 1 && d <= 4 ? `${w} ${a}~${b}시` : all;
  }).replace(/§/g, ' ');
  t = t.replace(/\d+\s*(명|층|부\)|호선|대\s*(이상|이하|환영|~)|번|km)/g, ' ')
    .replace(/(?<![\d시:])\d{1,2}\s*분\s*(모집|구|초청)/g, ' '); // '2분 모집'(인원)만 제거, '11시50분 초청'은 유지
  const re = new RegExp(`${PREF}${HM}\\s*(?:~|-|부터|에서)\\s*${PREF}${HM}\\s*(시|까지)?`);
  const one = new RegExp(`${PREF}(\\d{1,2})\\s*(?::\\s*(\\d{2})|시\\s*(?:(\\d{1,2})\\s*분|(반))?)`);
  let m = t.match(re);
  let s = null, e = null, explicit = false;
  if (m) {
    const [, p1, h1, c1, n1, b1, p2, h2, c2, n2, b2, tail] = m;
    const marked = p1 || p2 || c1 || c2 || n1 || n2 || /시/.test(m[0]) || tail;
    const bare = !marked;
    if (bare && !(+h1 >= 5 && +h1 <= 23 && +h2 >= 1 && +h2 <= 24)) m = null;
    else {
      explicit = !!(p1 || p2);
      s = toMin(p1, h1, c1 || n1 || (b1 ? 30 : 0));
      e = toMin(p2 || (p1 && PM.test(p1) ? p1 : null), h2, c2 || n2 || (b2 ? 30 : 0));
      if (s != null && !p1 && +h1 >= 1 && +h1 <= 6 && !/^0/.test(h1)) s += 720; // 1~6시 단독 → 오후 ('06:00'처럼 0을 붙여 쓴 건 24시간제로 보고 그대로)
      if (s != null && e != null && e <= s) {
        if (+h2 > 0 && +h2 < 12 && e + 720 > s) e += 720; // 12시간제 끝시각
        else e = (e % 720) + 1440; // 자정 넘김
      }
    }
  }
  if (!m && (m = t.match(one))) {
    const [, p1, h1, c1, n1, b1] = m;
    s = toMin(p1, h1, c1 || n1 || (b1 ? 30 : 0));
    if (s != null && !p1 && +h1 >= 1 && +h1 <= 6 && !/^0/.test(h1)) s += 720;
  }
  if (s == null) return { start: null, end: null };
  // 평일인데 오전/오후 표시 없이 '7시~10시'처럼만 쓴 글은 오전인지 저녁인지 알 수 없음
  const amb = !explicit && !PM.test(t) && !AM.test(t) && !/낮|야간|퇴근|조기/.test(t)
    && wdNum >= 1 && wdNum <= 5 && s >= 420 && s < 660 && (e == null || e <= 720);
  const f = x => x == null ? null : `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`;
  return { start: f(s), end: f(e), startMin: s, amb };
}

export function slotOf(startMin) {
  if (startMin == null) return null;
  const h = Math.floor(startMin / 60) % 24;
  if (h < 12) return '오전';
  if (h < 18) return '오후';
  return '저녁';
}

// 제목 속 조건 → 태그 (필터용). 제목에 적힌 것만 뽑음
const TAGS = [
  ['무료', /무료|게(스트)?비\s*(X|없|무|0원)|대관비\s*X/i],
  ['급구', /급구|급게스트|(?<![가-힣])급\s*[!\d(\[\]]|^[\s\[\](){}<>*★☆!~\-=.,#@]*급(?![여식])/],
  ['즐농', /즐농|즐겜|즐겁게|친목|매너\s*(농구|게임|팀)/],
  ['여성 환영', /여성|여자|남\s*[.·,/&]\s*여|남녀|혼성/],
  ['초보 환영', /초보|입문|하하|하\s*~\s*하|하\s*~\s*중|실력\s*무관|누구나/],
  ['실력자', /빡겜|빡농|열농|선출|실력자|상급자|중상\s*이상|실력\s*좋/],
  ['포지션 구함', /(?<!전\s*)(가드|빅맨|포워드|앞선|뒷선|밑선|윗선)|(?<![가-힣])센터\s*(분|[1-9]\s*명|한|두|구|모)|[1-5]\s*번\s*(포지션|or|,)/],
  ['늦참 가능', /늦참|조퇴/],
  ['풀코트', /풀\s*코트|정규\s*(사이즈|코트)|5\s*(대|vs)\s*5|5\s*:\s*5(?!\d)/i],
  ['주차', /주차\s*(O|ㅇ|가능|무료|있|지원)/i],
  ['샤워', /샤워\s*(O|ㅇ|가능|있)/i],
  ['냉방', /냉방|에어컨/],
];
export function parseTags(n) {
  const out = TAGS.filter(([, re]) => re.test(n)).map(([k]) => k);
  const age = [...n.matchAll(/([2-6])0\s*대/g)].map(m => +m[1]);
  const over = n.match(/([2-6])(\d)\s*세\s*(이상|↑|\+|부터)/); // "30세 이상", "35세↑"
  if (over) out.push(`${over[1]}0대+`);
  else if (age.length) out.push(`${Math.min(...age)}0대${age.length > 1 || /이상|↑|\+|부터/.test(n) ? '+' : ''}`);
  return out;
}

export function parsePost(title, headCont, postedYmd) {
  const n = normalize(title);
  const [y, m, d] = postedYmd.split('-').map(Number);
  const posted = mk(y, m, d);
  const { region1, region2 } = parseRegion(n, headCont);
  const { date, span } = parseDate(n, posted);
  const wdNum = date ? mk(...date.split('-').map(Number)).getUTCDay() : null;
  const { start, end, startMin, amb } = parseTime(n, span, wdNum);
  const wd = date ? WEEK[wdNum] : null;
  return {
    region1, region2, date, weekday: wd, start, end, ...(amb ? { amb: true } : {}),
    // 시각이 없으면 '오전/오후/저녁' 같은 말로 시간대만 추정
    slot: amb ? null : slotOf(startMin) ?? (/오전|아침|새벽/.test(n) ? '오전' : /저녁|밤|야간/.test(n) ? '저녁' : /오후|낮/.test(n) ? '오후' : null),
    closed: /마감(?!\s*(임박|직전|예정|전))|완료(?!\s*(후|되면))|종료/.test(n),
    free: /무료/.test(n),
    ...(() => { const t = parseTags(n); return t.length ? { tags: t } : {}; })(),
  };
}

// "12분 전" / "1시간 3분 전" / "20:26" / "26.09.24" → KST 기준 ISO 시각
export function postedAt(elapsed, nowMs = Date.now()) {
  const KST = 9 * 3600e3;
  const nowK = new Date(nowMs + KST);
  let m;
  if ((m = elapsed.match(/^(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*전$/)) && (m[1] || m[2])) {
    return new Date(nowMs - ((+m[1] || 0) * 60 + (+m[2] || 0)) * 60e3).toISOString();
  }
  if (/방금/.test(elapsed)) return new Date(nowMs).toISOString();
  if ((m = elapsed.match(/^(\d{1,2}):(\d{2})$/))) {
    const k = Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth(), nowK.getUTCDate(), +m[1], +m[2]);
    return new Date(k - KST).toISOString();
  }
  if ((m = elapsed.match(/^(\d{2})\.(\d{2})\.(\d{2})$/))) {
    return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]) - KST).toISOString();
  }
  return new Date(nowMs).toISOString();
}

export const kstYmd = iso => ymd(new Date(Date.parse(iso) + 9 * 3600e3));
