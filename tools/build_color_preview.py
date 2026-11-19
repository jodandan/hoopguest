#!/usr/bin/env python3
"""11-19 색 미리보기(/new/) 만들기 — 마루 바탕 + 빨강 머리 + 크림 배너.

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
LIGHT = ('--bg:#E7C796;--card:#FFF8EC;--text:#2A1408;--sub:#5A3A22;--muted:#6A4A30;--line:#D3AE78;--line2:#B98F57;--card-line:#EAD3AE;'
         '--accent:#C8102E;--accent-strong:#C8102E;--ink:#2A1408;--on-ink:#FFF8EC;--chip:#FFF8EC;--chip-on:#C8102E;--chip-on-text:#fff;'
         '--seg-on:#C8102E;--pill:#F1DDB8;--pill-text:#2A1408;--time:#B42318;--soon:#B42318;--hl:#FFB000;--hl-text:#2A1408;--btn-soft:#F6E6C8;--btn-soft2:#F6E6C8;'
         '--hero-bg:#C8102E;--hero-ink:#FFF8EC;--panel:#2A1408;--panel-ink:#FFF8EC;--banner:#FFF8EC;--banner-ink:#2A1408;--banner-sub:#6A4A30;--banner-bar:#C8102E')
DARK = ('--bg:#1A1212;--card:#251A19;--text:#F5ECE2;--sub:#C9B9AE;--muted:#AE9E93;--line:#382827;--line2:#4E3836;--card-line:#382827;'
        '--accent:#FF5A4A;--accent-strong:#E0442F;--ink:#F5ECE2;--on-ink:#1A1212;--chip:transparent;--chip-on:#E7C796;--chip-on-text:#1A1212;'
        '--seg-on:#E7C796;--pill:#2E2120;--pill-text:#F5ECE2;--time:#E7C796;--soon:#FF6F5E;--hl:#E7C796;--hl-text:#1A1212;--btn-soft:#2A1E1D;--btn-soft2:#2A1E1D;'
        '--hero-bg:#8E0F22;--hero-ink:#FFF2E6;--panel:#1A1212;--panel-ink:#FFF2E6;--banner:#F5ECE2;--banner-ink:#1A1212;--banner-sub:#5A4640;--banner-bar:#C8102E')
CSS = f'''<style>
{MARK}
{R}{{{LIGHT}}}
@media (prefers-color-scheme:dark){{{R}:not([data-theme="light"]){{{DARK}}}}}
{R}[data-theme="dark"]{{{DARK}}}
body{{background-image:none}}
.hero{{background:var(--hero-bg)!important;--hero-text:var(--hero-ink);--hero-sub:var(--hero-ink)}}
.hero .brand b,.hero h1,.hero .meta,.hero a{{color:var(--hero-ink)}}
.homepanel,.brand .label{{background:var(--panel)!important;color:var(--panel-ink)!important}}
.hgcourt .wood{{background:var(--banner)!important;color:var(--banner-ink)!important}}
.hgcourt .wood small{{color:var(--banner-sub)!important}}
.hgcourt .wood i{{background:var(--banner-bar)!important}}
</style>
'''
out = src
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
