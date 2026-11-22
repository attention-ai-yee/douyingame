#!/usr/bin/env python3
"""从美术原图裁出首页用的竖版战场 bg_home_<山>.jpg（750×1164）。

用法：python3 tools/art/home_bg.py     依赖：Pillow
"""
import os
from PIL import Image, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'art', 'originals')
OUT = os.path.join(ROOT, 'client', 'assets', 'resources', 'skin')
W, H = 750, 1164
# 原图名 → 山的 id；focus 是横向取景中心（0 左 1 右）
MAP = {'南山背景.png': ('nanshan', 0.42), '西山背景.png': ('xishan', 0.5), '北山背景.png': ('beidongzhong', 0.5)}

for name, (mid, focus) in MAP.items():
    portrait_id = 'north' if mid == 'beidongzhong' else mid
    portrait = os.path.join(SRC, 'polish', f'home-{portrait_id}.png')
    p = portrait if os.path.exists(portrait) else os.path.join(SRC, name)
    if not os.path.exists(p):
        print('缺少原图', p)
        continue
    with Image.open(p) as source:
        im = ImageOps.fit(source.convert('RGB'), (W, H), Image.LANCZOS, centering=(focus, 0.5))
    out = os.path.join(OUT, f'bg_home_{mid}.jpg')
    im.save(out, quality=80, optimize=True, progressive=True)
    print(out.replace(ROOT + '/', ''), os.path.getsize(out) // 1024, 'KB')
