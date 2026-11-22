#!/usr/bin/env python3
"""生成游戏字体 client/assets/resources/font/yushou.ttf（站酷快乐体，SIL OFL 1.1 授权，可商用）。

步骤：
1. 把 node_modules/@fontsource/zcool-kuaile 里按字符分片的 woff2 合并成一个完整字体；
2. 字体里缺的几个生僻字（狌、褢、讙、鱬、亶、杻、槃、箓）用同一字体的部件拼出来（font_synth.py）；
3. 补画几个符号（★ ☆ ✦ ✓ ✕ ▶ ◀ ● ○ ‹ › → ↺ ∞）；
4. 只保留游戏里实际用到的字（扫描脚本和配置表里的字符串 + 全部 ASCII），减小体积。

改了界面文字、配置表之后重新运行一次：python3 tools/art/font.py
依赖：pip install fonttools brotli
单元测试 tests/font.test.ts 会检查界面用到的字是否都在字体里。
"""
import glob
import json
import math
import os
import re
import sys
import tempfile

from fontTools import merge, subset
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

sys.path.insert(0, os.path.dirname(__file__))
import font_synth  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'node_modules', '@fontsource', 'zcool-kuaile', 'files')
OUT = os.path.join(ROOT, 'client', 'assets', 'resources', 'font', 'yushou.ttf')
SCAN = ['client/assets/scripts/**/*.ts', 'client/assets/resources/config/*.json']

# 界面上会动态拼出来、源码里不一定出现的字
EXTRA = '0123456789万亿兆，。、！？：；（）「」《》·×—…%+-/'


def used_chars():
    chars = set(chr(c) for c in range(0x20, 0x7f))
    lit = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")
    def walk(v):
        # 配置表里以 _ 开头的键（_doc 等说明文字）不显示在界面上
        if isinstance(v, dict):
            for k, x in v.items():
                if not k.startswith('_'):
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str):
            chars.update(ch for ch in v if ord(ch) > 127)

    for pat in SCAN:
        for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
            src = open(f, encoding='utf-8').read()
            if f.endswith('.json'):
                walk(json.loads(src))
                continue
            for groups in lit.findall(src):
                for s in groups:
                    chars.update(ch for ch in s if ord(ch) > 127)
    chars.update(EXTRA)
    return chars


def merge_chunks(tmp):
    files = sorted(glob.glob(os.path.join(SRC, '*-400-normal.woff2')))
    if not files:
        sys.exit('找不到 @fontsource/zcool-kuaile，先在仓库根目录运行 npm install')
    ttfs = []
    for i, f in enumerate(files):
        t = TTFont(f)
        t.flavor = None
        p = os.path.join(tmp, f'c{i}.ttf')
        t.save(p)
        ttfs.append(p)
    out = os.path.join(tmp, 'merged.ttf')
    merge.Merger().merge(ttfs).save(out)
    return out


def add_symbols(path):
    """补画符号：几何图形，按字体的字身框居中。"""
    f = TTFont(path)
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    adv = f['hmtx'][cmap[ord('生')]][0]
    asc = f['hhea'].ascent
    desc = f['hhea'].descent
    cy = (asc + desc) / 2 + adv * 0.06
    cx = adv / 2
    R = adv * 0.40

    def poly(pen, pts):
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()

    def star(r, inner, rot=-90, n=5, x=cx, y=cy, rev=False):
        pts = []
        for i in range(n * 2):
            rr = r if i % 2 == 0 else r * inner
            a = math.radians(rot + i * 180 / n)
            pts.append((round(x + rr * math.cos(a)), round(y - rr * math.sin(a))))
        return pts[::-1] if rev else pts

    def circle(r, rev=False, x=cx, y=cy, k=32):
        pts = [(round(x + r * math.cos(2 * math.pi * i / k)), round(y + r * math.sin(2 * math.pi * i / k))) for i in range(k)]
        return pts if rev else pts[::-1]

    def thick_line(p0, p1, w):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L * w / 2, dx / L * w / 2
        return [(round(p0[0] + nx), round(p0[1] + ny)), (round(p1[0] + nx), round(p1[1] + ny)), (round(p1[0] - nx), round(p1[1] - ny)), (round(p0[0] - nx), round(p0[1] - ny))]

    W = adv * 0.11
    shapes = {
        '★': [star(R, 0.45)],
        '☆': [star(R, 0.45), star(R * 0.62, 0.45, rev=True)],
        '✦': [star(R, 0.30, n=4)],
        '●': [circle(R * 0.8)],
        '○': [circle(R * 0.8), circle(R * 0.8 - W, rev=True)],
        '▶': [[(round(cx - R * 0.6), round(cy + R * 0.8)), (round(cx + R * 0.8), round(cy)), (round(cx - R * 0.6), round(cy - R * 0.8))]],
        '◀': [[(round(cx + R * 0.6), round(cy - R * 0.8)), (round(cx - R * 0.8), round(cy)), (round(cx + R * 0.6), round(cy + R * 0.8))]],
        '✓': [thick_line((cx - R * 0.7, cy), (cx - R * 0.15, cy - R * 0.55), W), thick_line((cx - R * 0.15, cy - R * 0.55), (cx + R * 0.75, cy + R * 0.65), W)],
        '✕': [thick_line((cx - R * 0.6, cy - R * 0.6), (cx + R * 0.6, cy + R * 0.6), W), thick_line((cx - R * 0.6, cy + R * 0.6), (cx + R * 0.6, cy - R * 0.6), W)],
        '‹': [thick_line((cx + R * 0.2, cy + R * 0.5), (cx - R * 0.3, cy), W), thick_line((cx - R * 0.3, cy), (cx + R * 0.2, cy - R * 0.5), W)],
        '›': [thick_line((cx - R * 0.2, cy + R * 0.5), (cx + R * 0.3, cy), W), thick_line((cx + R * 0.3, cy), (cx - R * 0.2, cy - R * 0.5), W)],
        '→': [thick_line((cx - R * 0.8, cy), (cx + R * 0.6, cy), W), [(round(cx + R * 0.3), round(cy + R * 0.4)), (round(cx + R * 0.85), round(cy)), (round(cx + R * 0.3), round(cy - R * 0.4))]],
        '↺': [circle(R * 0.7), circle(R * 0.7 - W, rev=True)],
        '∞': [circle(R * 0.38, x=cx - R * 0.38), circle(R * 0.38 - W, rev=True, x=cx - R * 0.38), circle(R * 0.38, x=cx + R * 0.38), circle(R * 0.38 - W, rev=True, x=cx + R * 0.38)],
    }
    glyf, hmtx = f['glyf'], f['hmtx']
    order = f.getGlyphOrder()
    for ch, polys in shapes.items():
        if ord(ch) in cmap:
            continue
        pen = TTGlyphPen(gs)
        for pts in polys:
            poly(pen, pts)
        name = 'uni%04X' % ord(ch)
        glyf[name] = pen.glyph()
        if name not in order:
            order.append(name)
        hmtx[name] = (adv, 0)
        for t in f['cmap'].tables:
            if t.isUnicode():
                t.cmap[ord(ch)] = name
    f.setGlyphOrder(order)
    f['maxp'].numGlyphs = len(order)
    f.save(path)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        merged = merge_chunks(tmp)
        full = os.path.join(tmp, 'full.ttf')
        font_synth.run(merged, full)
        add_symbols(full)
        chars = used_chars()
        f = TTFont(full)
        cmap = f.getBestCmap()
        missing = sorted(ch for ch in chars if ord(ch) not in cmap and ch.strip())
        opts = subset.Options()
        opts.layout_features = []
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.glyph_names = False
        s = subset.Subsetter(opts)
        s.populate(unicodes=[ord(c) for c in chars])
        s.subset(f)
        f['name'].setName('Yushou Rounded (ZCOOL KuaiLe subset, OFL)', 1, 3, 1, 0x409)
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        f.save(OUT)
    print(f'字体 → {os.path.relpath(OUT, ROOT)}：{len(chars)} 个字，{os.path.getsize(OUT) // 1024} KB')
    if missing:
        print('字体里没有、也没补上的字（界面上会显示成方块，请换个写法）：', ''.join(missing))


if __name__ == '__main__':
    main()
