"""用站酷快乐体自己的部件拼出字体里缺的几个生僻字（左右结构取左偏旁 + 右部件；上下结构取上下部件）。"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen, DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

def contours(font, ch):
    gs = font.getGlyphSet()
    name = font.getBestCmap()[ord(ch)]
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    out, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ('closePath', 'endPath'):
            out.append(cur); cur = []
    if cur: out.append(cur)
    res = []
    for c in out:
        bp = BoundsPen(None)
        for op, args in c: getattr(bp, op)(*args)
        if bp.bounds: res.append((c, bp.bounds))
    return res

def bbox(cs):
    xs0 = min(b[0] for _, b in cs); ys0 = min(b[1] for _, b in cs); xs1 = max(b[2] for _, b in cs); ys1 = max(b[3] for _, b in cs)
    return xs0, ys0, xs1, ys1

def pick(cs, fn):
    return [(c, b) for c, b in cs if fn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b)]

def place(cs, box):
    """把一组轮廓缩放平移到目标框 box=(x0,y0,x1,y1)。"""
    x0, y0, x1, y1 = bbox(cs)
    tx0, ty0, tx1, ty1 = box
    sx = (tx1 - tx0) / max(1, x1 - x0); sy = (ty1 - ty0) / max(1, y1 - y0)
    return [(c, (sx, 0, 0, sy, tx0 - x0 * sx, ty0 - y0 * sy)) for c, _ in cs]

def build(font, parts, adv):
    gs = font.getGlyphSet()
    pen = TTGlyphPen(gs)
    for c, m in parts:
        tp = TransformPen(pen, m)
        for op, args in c: getattr(tp, op)(*args)
    return pen.glyph()

def run(src, dst):
    f = TTFont(src)
    cmap = f.getBestCmap()
    adv = f['hmtx'][cmap[ord('生')]][0]
    C = lambda ch: contours(f, ch)
    def left_of(ch, frac):  # 左偏旁
        return pick(C(ch), lambda cx, cy, b: cx < adv * frac)
    def right_of(ch, frac):
        return pick(C(ch), lambda cx, cy, b: cx >= adv * frac)
    def lr(left_parts, right_ch_or_parts, split):
        L = left_parts
        R = right_ch_or_parts if isinstance(right_ch_or_parts, list) else C(right_ch_or_parts)
        lb = bbox(L); full = bbox(C('生'))
        rb = (lb[2] + adv * 0.03, full[1], full[2], full[3])
        return [(c, (1, 0, 0, 1, 0, 0)) for c, _ in L] + place(R, rb)
    plans = {
        '狌': lambda: lr(left_of('狐', 0.36), '生', 0.36),
        '杻': lambda: lr(left_of('林', 0.42), '丑', 0.42),
        '讙': lambda: lr(left_of('说', 0.30), right_of('罐', 0.40), 0.30),
        '鱬': lambda: lr(left_of('鲤', 0.40), '需', 0.40),
        '亶': lambda: place(right_of('檀', 0.40), bbox(C('旦')) if False else (bbox(C('壹'))[0], bbox(C('壹'))[1], bbox(C('壹'))[2], bbox(C('壹'))[3])),
    }
    # 上下结构
    full = bbox(C('生'))
    def tb(top_parts, bottom_parts, ratio):
        y0, y1 = full[1], full[3]
        mid = y0 + (y1 - y0) * (1 - ratio)
        return place(top_parts, (full[0], mid + 10, full[2], y1)) + place(bottom_parts, (full[0] + (full[2] - full[0]) * 0.12, y0, full[2] - (full[2] - full[0]) * 0.12, mid - 10))
    pan = C('磐'); pb = bbox(pan); pmid = pb[1] + (pb[3] - pb[1]) * 0.42
    plans['槃'] = lambda: tb(pick(pan, lambda cx, cy, b: cy > pmid), C('木'), 0.58)
    fu = C('符'); fb = bbox(fu); fmid = fb[1] + (fb[3] - fb[1]) * 0.70
    plans['箓'] = lambda: tb(pick(fu, lambda cx, cy, b: cy > fmid), C('录'), 0.30)
    # 褢：裹 去掉中间的"果"，换成"鬼"
    guo = C('裹'); gb = bbox(guo); H = gb[3] - gb[1]
    keep = pick(guo, lambda cx, cy, b: not (gb[1] + H * 0.30 < cy < gb[1] + H * 0.78 and b[2] - b[0] < (gb[2] - gb[0]) * 0.9))
    mid_box = (gb[0] + (gb[2] - gb[0]) * 0.18, gb[1] + H * 0.36, gb[2] - (gb[2] - gb[0]) * 0.18, gb[1] + H * 0.80)
    plans['褢'] = lambda: [(c, (1, 0, 0, 1, 0, 0)) for c, _ in keep] + place(C('鬼'), mid_box)
    glyf = f['glyf']; hmtx = f['hmtx']
    order = f.getGlyphOrder()
    for ch, plan in plans.items():
        name = 'uni%04X' % ord(ch)
        g = build(f, plan(), adv)
        glyf[name] = g
        if name not in order: order.append(name)
        hmtx[name] = (adv, 0)
        for t in f['cmap'].tables:
            if t.isUnicode(): t.cmap[ord(ch)] = name
    f.setGlyphOrder(order)
    f['maxp'].numGlyphs = len(order)
    f.save(dst)
    print('合成', ''.join(plans.keys()))

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
