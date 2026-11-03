#!/usr/bin/env python3
"""11-02 맨체스터 시안 미리보기(/new/) 만들기.

docs/index.html(본 사이트)을 그대로 복사하고 새 디자인만 덧씌워 docs/new/index.html로 저장한다.
기능(JS)은 본 사이트와 같고, 아래 4가지만 바뀐다.
  1) 검색엔진 비노출(noindex)  2) 글꼴(Oswald·Black Han Sans) 추가
  3) 디자인 덮어쓰기 CSS        4) 상단 '우리 동네 코트' 띠 + '지금 내 동네' 패널, 같은 시각 접기, '~21:30' → '21:30까지'
본 사이트를 고친 뒤 미리보기도 맞추려면: python3 tools/build_new_preview.py
"""
import pathlib, sys

LIVE = '--live' in sys.argv  # --live: 본 사이트(docs/index.html)에 직접 적용 (11-03 본 적용)
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'docs/index.html').read_text(encoding='utf-8')
out = src


def rep(old, new, count=1):
    global out
    if out.count(old) < 1:
        sys.exit(f'바꿀 곳을 못 찾음: {old[:60]!r}')
    out = out.replace(old, new, count)


if 'id="homePanel"' in src:
    sys.exit('이미 새 디자인이 들어간 파일이에요 — 다시 적용하지 않아요')
# 1) 비노출 + 대표 주소는 본 사이트 (본 적용 땐 건너뜀)
if not LIVE: rep('<link rel="canonical" href="https://hoopguest.kro.kr/">',
    '<link rel="canonical" href="https://hoopguest.kro.kr/">\n<meta name="robots" content="noindex,nofollow">')

# 2) 글꼴
rep('<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Oswald:wght@500;600;700&display=swap" rel="stylesheet">')

# 3) 디자인 덮어쓰기
CSS = r'''
/* ===== 11-02 맨체스터 시안 (미리보기 /new/) — 농구장 색: 코트 고무 바닥(검정)·마루(나무)·백보드 빨강·전광판 호박색 ===== */
:root{--bg:#F4EFE6;--card:#FFFFFF;--text:#17181A;--sub:#5E5A53;--muted:#6E685F;--line:#E2DBCF;--line2:#C9C1B3;--card-line:#E2DBCF;--card-shadow:none;
  --accent:#B4231A;--accent-strong:#CF3326;--on-accent:#fff;--hero:transparent;--hero-text:#17181A;--hero-sub:#5E5A53;--ink:#17181A;--on-ink:#fff;
  --chip:#fff;--chip-on:#17181A;--chip-on-text:#fff;--pill:#ECE6DB;--pill-text:#17181A;--star:#B07D00;--track:transparent;--seg-on:#17181A;
  --btn-soft:#F3EEE6;--btn-soft2:#F3EEE6;--time:#A0520A;--soon:#B4231A;--tab-dim:#17181A;--hl:#FFE7A3;--hl-text:#3D2F00;
  --f-num:"Oswald",var(--f-body);--f-blk:"Black Han Sans",var(--f-body)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121212;--card:#1C1C1C;--text:#F2EEE6;--sub:#C9C3B8;--muted:#A9A39A;--line:#2E2E2E;--line2:#4A4A4A;--card-line:#2E2E2E;
  --accent:#FFB547;--hero-text:#F2EEE6;--hero-sub:#C9C3B8;--ink:#F2EEE6;--on-ink:#121212;--chip:transparent;--chip-on:#F2EEE6;--chip-on-text:#121212;
  --pill:#2A2A2A;--pill-text:#F2EEE6;--star:#FFB547;--seg-on:#F2EEE6;--btn-soft:#262626;--btn-soft2:#262626;--time:#FFB547;--soon:#FF6F5E;--tab-dim:#F2EEE6;
  --fresh:#2A2410;--fresh-line:#6B5520;--soft:#2A1614;--hl:#FFB547;--hl-text:#121212;--shadow:0 6px 18px rgba(0,0,0,.4)}}
:root[data-theme="dark"]{--bg:#121212;--card:#1C1C1C;--text:#F2EEE6;--sub:#C9C3B8;--muted:#A9A39A;--line:#2E2E2E;--line2:#4A4A4A;--card-line:#2E2E2E;
  --accent:#FFB547;--hero-text:#F2EEE6;--hero-sub:#C9C3B8;--ink:#F2EEE6;--on-ink:#121212;--chip:transparent;--chip-on:#F2EEE6;--chip-on-text:#121212;
  --pill:#2A2A2A;--pill-text:#F2EEE6;--star:#FFB547;--seg-on:#F2EEE6;--btn-soft:#262626;--btn-soft2:#262626;--time:#FFB547;--soon:#FF6F5E;--tab-dim:#F2EEE6;
  --fresh:#2A2410;--fresh-line:#6B5520;--soft:#2A1614;--hl:#FFB547;--hl-text:#121212;--shadow:0 6px 18px rgba(0,0,0,.4)}
body{background-image:radial-gradient(color-mix(in srgb,var(--text) 6%,transparent) 1px,transparent 1.6px);background-size:6px 6px}
.court,.tagln,.introtx{display:none}
.hero{background-image:none;border-bottom:0}
.hero .wrap{padding-bottom:4px}
.brand .label{background:#CF3326!important;color:#fff!important}
.themebtn:hover{background:color-mix(in srgb,var(--text) 10%,transparent)}
/* 상단 띠: 마루 + 백보드 빨강 패널 */
.hgcourt{position:relative;height:84px;margin:8px -16px 0;flex:0 0 calc(100% + 32px);width:calc(100% + 32px)}
.hgcourt .wood{position:absolute;left:-4px;top:8px;width:min(260px,64%);height:66px;background:repeating-linear-gradient(90deg,#D9A86C 0 46px,#D1A065 46px 47px,#D6A469 47px 92px,#CC9B60 92px 93px);transform:rotate(-3deg);clip-path:polygon(0 6%,8% 0,20% 4%,34% 0,50% 3%,66% 0,82% 4%,100% 0,98% 30%,100% 62%,97% 100%,80% 96%,62% 100%,44% 97%,26% 100%,10% 96%,0 100%,2% 66%,0 34%);padding:10px 12px 0 30px;color:#1A1208;display:flex;gap:8px}
.hgcourt .wood i{width:4px;height:44px;background:#CF3326;flex:none}
.hgcourt .wood b{display:block;font:400 26px/1.05 var(--f-blk)}
.hgcourt .wood small{display:block;margin-top:4px;font:800 11px/1.2 var(--f-body);color:#2E2010;white-space:nowrap}
.homepanel{position:absolute;right:16px;top:10px;width:140px;height:62px;border:0;background:#CF3326;color:#fff;transform:rotate(5deg);clip-path:polygon(0 6%,14% 0,40% 4%,70% 0,100% 3%,97% 40%,100% 100%,70% 96%,40% 100%,12% 96%,0 100%,3% 50%);display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 14px;cursor:pointer;text-align:left;font-family:var(--f-body)}
.homepanel small{font:800 11px/1.2 var(--f-body)}
.homepanel span{font:400 20px/1.15 var(--f-blk);white-space:nowrap}
.homepanel .hn{font:700 18px/1 var(--f-num);margin-left:4px}
.homepanel:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
@media (max-width:359px){.homepanel{width:118px}.hgcourt .wood b{font-size:22px}}
/* 탭: 각진 테두리 */
.tabs{border:1.5px solid var(--ink);border-radius:0;padding:0;gap:0;background:none}
.tab{border-radius:0;min-height:44px;color:var(--tab-dim)}
.tab+.tab{border-left:1.5px solid var(--ink)}
.tab[aria-selected="true"]{background:var(--ink);color:var(--on-ink);box-shadow:none}
.tab .n{background:transparent;color:inherit;font:600 14px/1 var(--f-num);text-shadow:none!important;opacity:1!important;padding:0;margin-left:4px}
/* 각진 모양 통일 */
.chip,.daystrip button,.search,.ibtn,.fsum,.nowbtn,.state,.card,.tag,.fpanel,.nudge,.cacts>.nav,.cacts>.shr,.cacts>.ics,.cacts>.rep,.pushbox,.sheet,.stale,.notice{border-radius:0!important}
.chk::before{border-radius:0}
.search{border-width:1.5px;border-color:var(--line2)}
.ibtn{border-width:1.5px}
.fpanel{background:var(--card);box-shadow:inset 0 0 0 1.5px var(--line2)}
.fpanel .lbl{font:800 13px/1 var(--f-body)!important;color:var(--sub);background:var(--card);box-shadow:6px 0 6px -2px var(--card)}
.fpanel .chip[aria-pressed="true"]:not(.all){background:var(--chip-on);border-color:var(--chip-on);color:var(--chip-on-text)}
/* 지금 갈 수 있는 곳: 켜고 끄는 버튼 */
.nowbtn,.nowbtn.empty{background:transparent;background-image:none;border:1.5px solid var(--line2);box-shadow:none;color:var(--text)}
.nowbtn small,.nowbtn.empty small{color:var(--time);text-shadow:none}
.nowbtn[aria-pressed="true"]{background:color-mix(in srgb,var(--time) 14%,transparent);box-shadow:none;border-color:var(--time)}
.ldot{background:var(--time);box-shadow:0 0 8px color-mix(in srgb,var(--time) 70%,transparent)}
/* 날짜 */
.daystrip button small{font-family:var(--f-num);background:none;color:inherit}
.daystrip button[aria-current="true"] small{background:none;color:inherit}
.day{font:400 24px/1.2 var(--f-blk)}
.dayh .day b{box-shadow:none}
.day small{font:500 var(--fs-sm)/1 var(--f-body)}
/* 카드: 시각 칸(호박색 숫자) + 세로줄 + 제목 */
.card,.compact .card{padding:0!important;gap:0;align-items:stretch;margin-bottom:6px}
.time,.compact .time{position:static;width:88px!important;flex:none;background:none;box-shadow:none;border-radius:0;padding:2px 10px 2px 14px;margin:12px 0;text-align:left;justify-content:flex-start;border-right:2px solid color-mix(in srgb,var(--text) 38%,transparent)}
.time .s{font:700 26px/1 var(--f-num);color:var(--time);text-shadow:none;letter-spacing:.5px;font-variant-numeric:tabular-nums}
.time .s::before,.time .e:empty::before{content:none}
.time .e{font:700 12px/1.3 var(--f-body);color:var(--sub);text-shadow:none;margin-top:5px}
.time .s.off{color:var(--muted);opacity:1;font-size:20px}
.time .unk{color:var(--sub)}.time .unk b{color:var(--time)}
.card .body{flex:1;min-width:0;padding:10px 26px 10px 12px}
.card .title{font-weight:800}
.card.same{margin-top:-7px;border-top:1px dashed var(--line2)}
.card.same .time .s{display:none}
.tag.soon{background:transparent;color:var(--soon);box-shadow:inset 0 0 0 1.5px currentColor}
.tag.soon.calm{color:var(--sub)}
.tag.x{transform:none;font:800 11px/1.65 var(--f-body)!important;background:#A9A39A;color:#121212;box-shadow:none;padding:0 6px}
.card.closed{opacity:1;background:color-mix(in srgb,var(--card) 70%,var(--bg))}
.card.closed .title{color:var(--muted)}
.card.closed .time .s{color:var(--muted);text-decoration:line-through}
.star{align-self:flex-start;margin:6px 4px 0 0}
.cacts>.nav{background:var(--accent-strong);color:#fff}
.cacts>.shr,.cacts>.ics,.cacts>.rep{background:transparent;box-shadow:inset 0 0 0 1.5px var(--line2);color:var(--text)}
.card .swipe{border-radius:0}
'''
rep('</style>\n<script>', CSS + '</style>\n<script>')

# 4) 상단 띠 HTML
rep('<span class="tagln" aria-hidden="true">Street 3on3 · Pick-up</span>',
    '<span class="tagln" aria-hidden="true">Street 3on3 · Pick-up</span>\n'
    '    <div class="hgcourt"><div class="wood" aria-hidden="true"><i></i><div><b>우리 동네 코트</b><small>서울·경기·인천 게스트·픽업·연습경기</small></div></div>'
    '<button class="homepanel" id="homePanel" type="button"><small>지금 내 동네</small><span id="homeTx">설정하기 →</span></button></div>')

# 5) 끝 시각 표시 '~21:30' → '21:30까지'
rep("p.end ? '~' + esc(p.end) : ''", "p.end ? esc(p.end) + '까지' : ''")

# 6) 같은 시각 접기 + 내 동네 패널 (render 안에서 매번)
rep('    list.innerHTML = html + unkHtml;\n',
    '    list.innerHTML = html + unkHtml;\n    markSame(list); homePanel();\n')
JS = r'''  // ---- 11-02 미리보기: 같은 날 같은 시각이 이어지면 시각은 첫 카드에만 ----
  function markSame(list) {
    list.querySelectorAll('.dayg').forEach(sec => { let prev = null;
      sec.querySelectorAll('.card').forEach(c => { const s = c.querySelector('.time .s'); const t = s && !s.classList.contains('off') ? s.textContent : null;
        c.classList.toggle('same', !!t && t === prev); prev = t; }); });
  }
  // ---- 11-02 미리보기: 상단 '지금 내 동네' 패널 — 내 동네를 안 골랐으면 '설정하기', 골랐으면 오늘 남은 글 수 ----
  function homePanel() {
    const b = $('homePanel'), tx = $('homeTx'); if (!b) return;
    if (!b.dataset.bound) { b.dataset.bound = '1'; b.onclick = () => {
      S.r1 = NEARBY; S.r2.clear(); track('nearby_open', { home: S.home || '-', from: 'hero' }); render();
      if (!S.home) { const f = $('fToggle'); if (f && f.getAttribute('aria-expanded') === 'false' && getComputedStyle(f).display !== 'none') f.click(); setTimeout(() => { const r = $('rowR1'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); }
      else $('list').scrollIntoView({ behavior: 'smooth', block: 'start' }); }; }
    if (!S.home) { tx.textContent = '설정하기 →'; b.setAttribute('aria-label', '내 동네 설정하기'); return; }
    const n = DATA.filter(p => p.board === S.board && p.date === TODAY && !p.closed && !isOver(p) && GEO[p.region2] && km(S.home, p.region2) <= S.radius).length;
    tx.innerHTML = `${esc(shortR2(S.home))}<b class="hn">${n}건</b>`;
    b.setAttribute('aria-label', `지금 내 동네 ${shortR2(S.home)} ${S.radius}km 안 오늘 ${n}건 — 눌러서 보기`);
  }
  function render() {
'''
rep('  function render() {\n', JS)

dst = ROOT / ('docs/index.html' if LIVE else 'docs/new/index.html')
dst.parent.mkdir(exist_ok=True)
dst.write_text(out, encoding='utf-8')
print('ok', dst, len(out))
