# 주말 현황 인스타 이미지 만들기 (매주 금요일 홍보용)
#   python3 promo/weekend.py            → promo/out/weekend-YYYYMMDD.png + 캡션 .txt
# docs/data.json 의 실제 글 수로만 채운다(지어낸 숫자 없음). 글꼴은 promo/fonts/ (OFL)
import json, datetime as dt, html, os, sys
from collections import Counter
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'promo')
OUT = os.path.join(P, 'out')
os.makedirs(OUT, exist_ok=True)
data = json.load(open(os.path.join(ROOT, 'docs', 'data.json'), encoding='utf-8'))
KST = dt.timezone(dt.timedelta(hours=9))
today = dt.date.fromisoformat(data['today'])
sat = today + dt.timedelta(days=(5 - today.weekday()) % 7)  # 이번(다가오는) 토요일
sun = sat + dt.timedelta(days=1)
W = {sat.isoformat(), sun.isoformat()}
seen, ps = set(), []
for p in data['posts']:
    if p.get('closed') or p.get('date') not in W or p['key'] in seen:
        continue
    seen.add(p['key']); ps.append(p)
if not ps:
    sys.exit('주말 글이 0건이라 만들지 않음')
n = len(ps)
day = Counter(p['date'] for p in ps)
board = Counter(p.get('board') for p in ps)
slot = Counter(p.get('slot') or '미정' for p in ps)
r2 = Counter(f"{p['region1']} {p['region2']}" for p in ps if p.get('region1') and p.get('region2'))
start = Counter(p['start'][:2] for p in ps if p.get('start'))
free = sum(1 for p in ps if p.get('free'))
# 동네 순위: 공동 순위 허용, 4곳까지
top, rank = [], 0
for i, (name, c) in enumerate(r2.most_common()):
    if i >= 4: break
    if not top or c != top[-1][2]: rank = i + 1
    top.append((rank, name, c))
slots = [(k, slot.get(k, 0)) for k in ('오전', '오후', '저녁', '미정') if slot.get(k, 0)]
mx = max(c for _, c in slots)
best_slot = max(slots[:3] if len(slots) > 1 else slots, key=lambda x: x[1])
hh, hc = start.most_common(1)[0] if start else ('', 0)
upd = dt.datetime.fromisoformat(data['updated'].replace('Z', '+00:00')).astimezone(KST)
WD = '월화수목금토일'
md = lambda d: f"{d.month}/{d.day}"
share = best_slot[1] / n
slot_note = f"주말은 <b class='r'>{best_slot[0]}</b>이 {'절반 넘어요' if share > .5 else f'{round(share*100)}%로 가장 많아요'}."
start_note = f"{int(hh)}시 시작이 {hc}건으로 최다." if hc else ''
esc = html.escape

bars = ''.join(f"<div class='bar{'' if k == best_slot[0] else ' dim'}'><span>{k}</span><i><b style='width:{max(3, c / mx * 100):.1f}%'></b></i><span>{c}</span></div>" for k, c in slots)
ranks = ''.join(f"<li><span class='n'>{r}</span>{esc(name)}<span class='x'>{c}</span></li>" for r, name, c in top)
other = n - board.get('guest', 0)
html_doc = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face{{font-family:Dokdo;src:url(fonts/EastSeaDokdo-sub.ttf)}}
@font-face{{font-family:Pre;font-weight:45 920;src:url(fonts/PretendardVariable.woff2)}}
@font-face{{font-family:Dot;src:url(fonts/DotGothic16-sub.ttf)}}
*{{box-sizing:border-box;margin:0}}
.c{{width:1080px;height:1350px;position:relative;overflow:hidden;font-family:Pre;color:#17181A;word-break:keep-all;padding:84px;
 background:repeating-linear-gradient(90deg,#E9D4B0 0 118px,#E3CBA2 118px 120px,#EBD7B5 120px 238px,#E0C69B 238px 240px)}}
.top{{display:flex;justify-content:space-between;align-items:center}}
.brand{{display:flex;align-items:center;gap:12px;font:400 44px/1 Dokdo;color:#CF3326}}.brand img{{width:44px}}
.date{{font:800 30px Pre;color:#fff;background:#CF3326;padding:12px 22px;border-radius:999px}}
h1{{font:900 70px/1.16 Pre;letter-spacing:-2.5px;margin-top:30px}}.r{{color:#CF3326}}
.board{{margin-top:28px;background:#121314;border-radius:32px;padding:28px 40px;display:grid;grid-template-columns:1.25fr 1fr 1fr;align-items:center;box-shadow:0 12px 0 rgba(0,0,0,.15)}}
.board .k{{font:700 26px Pre;color:#C9A56A}}
.board .v{{font:400 104px/1 Dot;color:#FFB23E;text-shadow:0 0 22px rgba(255,178,62,.5)}}
.board .v2{{font:400 76px/1 Dot;color:#FFB23E}}
.board > div + div{{border-left:2px solid #2C2A27;padding-left:34px}}
.row{{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:22px}}
.card{{background:#fff;border-radius:28px;padding:26px 30px;box-shadow:0 8px 0 rgba(0,0,0,.08)}}
.card h3{{font:800 32px Pre;margin-bottom:22px}}
.bar{{display:grid;grid-template-columns:76px 1fr 64px;align-items:center;gap:12px;margin:10px 0;font:700 28px Pre}}
.bar i{{display:block;height:30px;border-radius:8px;background:#E6DED0}}
.bar i b{{display:block;height:100%;border-radius:8px;background:#CF3326}}
.bar.dim i b{{background:#B9A98E}}
.bar span:last-child{{text-align:right}}
.note{{font:600 26px/1.4 Pre;color:#6A645A;margin-top:16px}}
.rank{{list-style:none;padding:0}}
.rank li{{display:flex;align-items:center;gap:16px;font:700 32px Pre;margin:8px 0}}
.rank li .n{{width:48px;height:48px;border-radius:50%;background:#17181A;color:#FFB23E;display:inline-flex;align-items:center;justify-content:center;font:400 30px Dot;flex:none}}
.rank li .x{{margin-left:auto;font:700 28px Pre;color:#CF3326}}
.mini{{padding:18px 24px}}.mini h3{{margin:0;font-size:26px;color:#6A645A}}.mini div{{font:400 54px Dot;margin-top:4px}}
.foot{{position:absolute;left:84px;right:84px;bottom:84px;display:flex;justify-content:space-between;align-items:center;background:#17181A;color:#F3EBDD;border-radius:28px;padding:26px 34px}}
.foot b{{font:800 40px Pre;color:#fff}}.foot small{{font:600 24px/1.4 Pre;color:#C9BFA9;display:block}}
</style></head><body>
<section class="c" id="w">
 <div class="top"><div class="brand"><img src="ball.svg">훕게스트</div><div class="date">{md(sat)}(토) ~ {md(sun)}(일)</div></div>
 <h1>이번 주말,<br>농구 모집 글 <span class="r">{n}건</span></h1>
 <div class="board"><div><div class="k">주말 모집 글</div><div class="v">{n}</div></div>
  <div><div class="k">토요일</div><div class="v2">{day.get(sat.isoformat(),0)}</div></div>
  <div><div class="k">일요일</div><div class="v2">{day.get(sun.isoformat(),0)}</div></div></div>
 <div class="row">
  <div class="card"><h3>시간대별</h3>{bars}<p class="note">{slot_note}<br>{start_note}</p></div>
  <div class="card"><h3>많이 열리는 동네</h3><ul class="rank">{ranks}</ul></div>
 </div>
 <div class="row" style="grid-template-columns:1fr 1fr 1fr;gap:18px">
  <div class="card mini"><h3>게스트 구인</h3><div>{board.get('guest',0)}</div></div>
  <div class="card mini"><h3>연습경기·픽업</h3><div>{other}</div></div>
  <div class="card mini"><h3>무료 표시</h3><div>{free}</div></div>
 </div>
 <div class="foot"><div><b>hoopguest.kro.kr</b><small>{upd.month}/{upd.day}({WD[upd.weekday()]}) {upd.hour}시 기준 · 주말까지 글이 더 올라와요</small></div><div style="font:800 30px Pre;color:#FFB23E">프로필 링크 →</div></div>
</section></body></html>"""
hp = os.path.join(P, '_weekend.html')
open(hp, 'w', encoding='utf-8').write(html_doc)
png = os.path.join(OUT, f"weekend-{sat:%Y%m%d}.png")
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1080, 'height': 1350})
    pg.goto('file://' + hp); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(500)
    loaded = pg.evaluate("[...document.fonts].filter(f=>f.status==='loaded').length")
    gap = pg.evaluate("(()=>{const f=document.querySelector('.foot').getBoundingClientRect().top;const r=[...document.querySelectorAll('.row')].pop().getBoundingClientRect().bottom;return Math.round(f-r)})()")
    pg.locator('#w').screenshot(path=png); b.close()
os.remove(hp)
if loaded < 3 or gap < 8:
    sys.exit(f'점검 실패: 글꼴 {loaded}/3, 하단 간격 {gap}px')
top_txt = ', '.join(f"{name.split()[-1]} {c}건" for _, name, c in top[:3])
cap = f"""이번 주말({md(sat)}~{md(sun)}) 서울·경기·인천 농구 모집 글이 {n}건 올라와 있어요.

주말엔 {best_slot[0]} 경기가 {'절반을 넘고' if share > .5 else '가장 많고'}{f', {int(hh)}시 시작이 제일 많아요' if hc else ''}. 많이 열리는 동네는 {top_txt}이에요.

내 동네·시간대 글만 골라 보려면 프로필 링크 → hoopguest.kro.kr
금요일마다 주말 현황 올릴게요.

#농구게스트 #주말농구 #픽업게임 #농구동호회 #농구"""
open(png[:-4] + '.txt', 'w', encoding='utf-8').write(cap)
print(png); print(cap)
