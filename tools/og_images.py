#!/usr/bin/env python3
"""공유 미리보기 이미지(1200x630) 만들기 — 카톡·인스타 등에 링크를 붙였을 때 뜨는 그림.

만드는 것
  docs/og.jpg                    첫 화면·기본 (사이트 새 디자인: 검정 코트·마루·백보드 빨강·호박색)
  docs/og/<광역>.jpg             광역 페이지 (예: og/seoul.jpg)
  docs/og/<광역>-<동네>.jpg      동네 페이지 + 그 동네 글 공유 페이지(/p/) (예: og/seoul-gangdong.jpg)
동네 이름은 docs/r/ 아래 페이지의 <title> 앞부분에서 읽는다. 동네가 새로 생기면 다시 실행:
  python3 tools/og_images.py
글꼴은 Noto Sans CJK KR(이 컴퓨터에 깔린 것)을 쓴다. 카톡은 이미지를 오래 캐시하므로 바꿀 땐 pages.mjs의 OG_V를 올린다.
"""
import pathlib, re, html
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
OUT = DOCS / 'og'
OUT.mkdir(exist_ok=True)

BALL = '<svg width="64" height="64" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#E8742C" stroke="#121212" stroke-width="1.3"/><path d="M1.5 12h21M12 1.5v21M4.7 4.6c3.2 3.3 3.2 11.5 0 14.8M19.3 4.6c-3.2 3.3-3.2 11.5 0 14.8" fill="none" stroke="#121212" stroke-width="1.3"/></svg>'

def card(small, big, sub, right_top, right_big):
    big_size = 150 if len(big) <= 3 else 120 if len(big) <= 4 else 96
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;box-sizing:border-box}}
body{{width:1200px;height:630px;overflow:hidden;font-family:"Noto Sans CJK KR",sans-serif;color:#F2EEE6;
 background:radial-gradient(rgba(255,255,255,.05) 1.5px,transparent 2px) 0 0/9px 9px,radial-gradient(90% 80% at 85% 0%,#262626 0%,#141414 60%),#141414;position:relative}}
.top{{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:16px}}
.top b{{font-weight:900;font-size:44px;letter-spacing:-1px}}
.top i{{font-style:normal;font-size:22px;font-weight:700;background:#CF3326;color:#fff;padding:4px 14px;border-radius:999px}}
.wood{{position:absolute;left:-30px;top:170px;width:760px;height:{250 if small else 230}px;transform:rotate(-2.5deg);
 background:repeating-linear-gradient(90deg,#D9A86C 0 120px,#CF9E62 120px 122px,#D6A469 122px 240px,#CC9B60 240px 242px);
 clip-path:polygon(0 5%,8% 0,22% 4%,38% 0,55% 3%,72% 0,88% 4%,100% 0,98% 35%,100% 70%,97% 100%,80% 96%,62% 100%,44% 97%,26% 100%,10% 96%,0 100%,2% 60%);
 padding:30px 40px 0 104px;color:#1A1208}}
.wood:before{{content:"";position:absolute;left:66px;top:42px;width:10px;height:{150 if small else 140}px;background:#CF3326}}
.wood small{{display:block;font-size:40px;font-weight:900;color:#4A3416;line-height:1}}
.wood strong{{display:block;font-size:{big_size}px;font-weight:900;letter-spacing:-4px;line-height:1.05}}
.panel{{position:absolute;right:48px;top:190px;width:400px;height:200px;white-space:nowrap;word-break:keep-all;background:#CF3326;color:#fff;transform:rotate(3deg);
 clip-path:polygon(0 6%,14% 0,40% 4%,70% 0,100% 3%,97% 40%,100% 100%,70% 96%,40% 100%,12% 96%,0 100%,3% 50%);
 display:flex;flex-direction:column;justify-content:center;padding:0 36px}}
.panel span{{font-size:30px;font-weight:700}}
.panel b{{font-size:48px;font-weight:900;letter-spacing:-1.5px;line-height:1.15}}
.sub{{position:absolute;left:64px;bottom:58px;right:64px;display:flex;justify-content:space-between;align-items:flex-end}}
.sub p{{font-size:32px;font-weight:700;color:#C9C3B8}}
.sub em{{font-style:normal;font-size:30px;font-weight:700;color:#FFB547}}
</style></head><body>
<div class="top">{BALL}<b>훕게스트</b><i>모아보기</i></div>
<div class="wood">{f'<small>{html.escape(small)}</small>' if small else ''}<strong>{html.escape(big)}</strong></div>
<div class="panel"><span>{html.escape(right_top)}</span><b>{html.escape(right_big)}</b></div>
<div class="sub"><p>{html.escape(sub)}</p><em>hoopguest.kro.kr</em></div>
</body></html>'''

def jobs():
    yield DOCS / 'og.jpg', card('', '우리 동네 코트', '서울·경기·인천 농구 모집 글을 한눈에', '오늘 열린 자리', '게스트·픽업게임')
    for d1 in sorted((DOCS / 'r').iterdir()):
        if not d1.is_dir():
            continue
        t = re.search(r'<title>([^<]+)</title>', (d1 / 'index.html').read_text(encoding='utf-8')).group(1)
        r1 = t.split()[0]
        yield OUT / f'{d1.name}.jpg', card('', r1, f'{r1} 농구 게스트·픽업게임·교류전 모집 글', '오늘 열린 자리', '지금 확인하기')
        for d2 in sorted(p for p in d1.iterdir() if p.is_dir()):
            t2 = re.search(r'<title>([^<]+)</title>', (d2 / 'index.html').read_text(encoding='utf-8')).group(1)
            r2 = t2.split()[1]
            yield OUT / f'{d1.name}-{d2.name}.jpg', card(r1, r2, f'{r1} {r2} 농구 게스트·픽업게임·교류전 모집 글', f'{r2} 농구', '같이 뛸 사람?')

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    n = 0
    for out, h in jobs():
        pg.set_content(h)
        pg.wait_for_timeout(50)
        pg.screenshot(path=str(out), type='jpeg', quality=84)
        n += 1
    b.close()
print('만든 이미지', n)
