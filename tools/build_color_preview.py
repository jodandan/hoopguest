#!/usr/bin/env python3
"""11-19 색 미리보기(/new/) 만들기 — G3: 머리 = 코트 마루(광택·라인·빨강 페인트존), 몸통 = 따뜻한 흰색, 림 주황 띠.

docs/index.html(본 사이트)을 그대로 복사하고 색만 덧씌워 docs/new/index.html로 저장한다.
기능·구조는 본 사이트와 같고, 바뀌는 건 색과 검색엔진 비노출(noindex)뿐.
본 사이트를 고친 뒤 미리보기도 맞추려면: python3 tools/build_color_preview.py
본 적용(본 사이트에 바로 넣기): python3 tools/build_color_preview.py --live
"""
import pathlib, sys

LIVE = '--live' in sys.argv
ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'docs/index.html').read_text(encoding='utf-8')
MARK = '/* ===== 11-19 색: 마루 + 빨강 ===== */'
if MARK in src:
    sys.exit('이미 새 색이 들어간 파일이에요 — 다시 적용하지 않아요')

R = ':root:root:root:root'  # 기존 테마 규칙보다 우선
# 마루 = 코트(머리, 점프볼 센터서클+하프라인), 빨강 = 골대(버튼), 림 주황 = 머리 아래 띠·선택
LIGHT = ('--bg:#FAF6EF;--card:#FFFBF4;--text:#24170C;--sub:#5A4330;--muted:#6B5440;--line:#E9D9BF;--line2:#CDB08A;--card-line:#EEDFC6;'
         '--accent:#C2410C;--accent-strong:#C2410C;--ink:#24170C;--on-ink:#FFFBF4;--chip:#FFFBF4;--chip-on:#C2410C;--chip-on-text:#fff;'
         '--seg-on:#24170C;--pill:#F3E4CA;--pill-text:#24170C;--time:#C2410C;--soon:#C8102E;--hl:#FFB000;--hl-text:#24170C;--btn-soft:#F7EAD3;--btn-soft2:#F7EAD3;'
         '--wood:#DDB27A;--wood-gloss:rgba(255,255,255,.28);--wood-seam:rgba(120,70,20,.09);--court-line:rgba(255,255,255,.8);--paint:rgba(200,16,46,.85);'
         '--hero-ink:#24170C;--banner:#FFFBF4;--banner-ink:#24170C;--banner-sub:#6B5440;--red:#C8102E;--rim:#E4572E;--card-shadow2:0 1px 2px rgba(60,30,5,.08),0 6px 16px rgba(60,30,5,.06)')
DARK = ('--bg:#15110D;--card:#211A14;--text:#F4EADF;--sub:#C8B8A6;--muted:#AD9C8A;--line:#33281F;--line2:#4A3B2E;--card-line:#33281F;'
        '--accent:#FF7A4D;--accent-strong:#FF7A4D;--ink:#F4EADF;--on-ink:#15110D;--chip:transparent;--chip-on:#FF7A4D;--chip-on-text:#15110D;'
        '--seg-on:#F4EADF;--pill:#2B221A;--pill-text:#F4EADF;--time:#F2B36B;--soon:#FF6F5E;--hl:#F2B36B;--hl-text:#15110D;--btn-soft:#271F18;--btn-soft2:#271F18;'
        '--wood:#5A3E22;--wood-gloss:rgba(255,220,170,.10);--wood-seam:rgba(0,0,0,.25);--court-line:rgba(255,240,220,.55);--paint:rgba(170,20,40,.75);'
        '--hero-ink:#F8EEE2;--banner:#F4EADF;--banner-ink:#15110D;--banner-sub:#5A4330;--red:#C8102E;--rim:#E4572E;--card-shadow2:0 1px 2px rgba(0,0,0,.3),0 6px 16px rgba(0,0,0,.25)')
CSS = f'''<style>
{MARK}
{R}{{{LIGHT}}}
@media (prefers-color-scheme:dark){{{R}:not([data-theme="light"]){{{DARK}}}}}
{R}[data-theme="dark"]{{{DARK}}}
body{{background:var(--bg)!important;background-image:none!important}}
.hero{{position:relative;overflow:hidden;padding-bottom:6px;--hero-text:var(--hero-ink);--hero-sub:var(--hero-ink);
  background:linear-gradient(90deg,transparent calc(100% - 71.5px),var(--court-line) calc(100% - 71.5px),var(--court-line) calc(100% - 68.5px),transparent calc(100% - 68.5px)),linear-gradient(180deg,var(--wood-gloss),transparent 60%),repeating-linear-gradient(90deg,var(--wood-seam) 0 1px,transparent 1px 58px),var(--wood)!important}}
.hero::before{{content:"";position:absolute;right:-40px;top:50%;width:220px;height:220px;margin-top:-110px;border-radius:50%;border:3px solid var(--court-line);pointer-events:none}}
.hero::after{{content:"";position:absolute;left:0;right:0;bottom:0;height:6px;background:var(--rim)}}
.hero > *{{position:relative;z-index:1}}
.hero .brand b,.hero h1,.hero .meta,.hero a{{color:var(--hero-ink)}}
.homepanel,.brand .label{{background:var(--red)!important;color:#fff!important}}
.hgcourt .wood{{background:var(--banner)!important;color:var(--banner-ink)!important}}
.hgcourt .wood small{{color:var(--banner-sub)!important}}
.hgcourt .wood i{{background:var(--red)!important}}
.tabs{{border-color:var(--line2)!important}}
.card{{box-shadow:var(--card-shadow2)!important;border-color:transparent!important}}
.search,.nowbtn,.fsum,.ibtn{{border-color:var(--line)!important}}
/* 스킬 점검 반영 — web-design-guidelines·make-interfaces-feel-better·Emil Kowalski·접근성 */
body{{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}}
h1,h2{{text-wrap:balance}}
.card .title{{text-wrap:pretty}}
@media (pointer:coarse){{.daystrip button,.search,.nowbtn,.fsum,.linkbtn{{min-height:44px!important}}.guidelnk{{display:inline-flex;align-items:center;min-height:44px}}.card .more{{min-width:44px!important;min-height:44px!important}}}}
.card{{animation-duration:.18s,2.6s!important}}
.toast{{transition-timing-function:cubic-bezier(.23,1,.32,1)!important}}
/* claude-design-system-prompt: ai-slop-check·hierarchy-rhythm-review — 구분 방식 하나로(그림자·면), 상자 테두리 줄이기 */
.tabs{{border:0!important;background:var(--pill)!important;border-radius:14px!important;padding:4px!important;gap:4px!important}}
.tab{{border:0!important;border-radius:10px!important;box-shadow:none!important}}
.tab[aria-selected="true"]{{background:var(--ink)!important;color:var(--on-ink)!important}}
.daystrip button{{border-color:transparent!important;background:var(--pill)!important}}
.daystrip button[aria-current="true"]{{background:var(--chip-on)!important;color:var(--chip-on-text)!important}}
.ibtn{{border-color:transparent!important;background:var(--pill)!important}}
.ibtn:active{{transform:scale(.96)!important}}
.nowbtn,.fsum,.search{{border-color:var(--line)!important;background:var(--card)!important}}
</style>
'''
out = src
# 브라우저 위쪽 막대 색(theme-color)도 새 머리 색에 맞춤
for a, b in (('content="#CF3326"', 'content="#DDB27A"'), ('content="#111316"', 'content="#3A2A18"'),
             ("'#111316':'#CF3326'", "'#3A2A18':'#DDB27A'"), ("'#111316' : '#CF3326'", "'#3A2A18' : '#DDB27A'")):
    out = out.replace(a, b)
if not LIVE:
    tag = '<link rel="canonical" href="https://hoopguest.kro.kr/">'
    if tag not in out:
        sys.exit('canonical 태그를 못 찾음')
    out = out.replace(tag, tag + '\n<meta name="robots" content="noindex,nofollow">', 1)
i = out.rfind('</head>')
if i < 0:
    sys.exit('</head>를 못 찾음')
out = out[:i] + CSS + out[i:]
dst = ROOT / ('docs/index.html' if LIVE else 'docs/new/index.html')
dst.parent.mkdir(exist_ok=True)
dst.write_text(out, encoding='utf-8')
print('저장:', dst)
