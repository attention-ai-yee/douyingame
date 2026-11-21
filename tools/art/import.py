#!/usr/bin/env python3
"""把 art/inbox/ 里的原图（ChatGPT 等生成）处理后放进游戏素材目录。

用法：
    python3 tools/art/import.py            # 处理 art/inbox/ 下所有图片，原图挪到 art/originals/
    python3 tools/art/import.py --keep     # 原图留在 inbox
    python3 tools/art/import.py --status   # 只看还缺哪些图

文件名用《美术素材清单》（docs/美术素材清单.md）里的中文名，例如 九尾狐.png、南山背景.png；
也可以直接用游戏里的素材名，例如 beast_jiuweihu.png。

处理：
- 异兽、图标：纯色背景自动抠成透明 → 裁掉四周空白 → 补成正方形 → 缩放 → 压缩成 PNG
- 背景：缩放并裁成目标比例（保留下方地面）→ JPG
依赖：Pillow、numpy
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "art" / "inbox"
ORIGINALS = ROOT / "art" / "originals"
OUT = ROOT / "client" / "assets" / "resources" / "skin"
BEASTS = json.loads((ROOT / "client/assets/resources/config/beasts.json").read_text(encoding="utf-8"))
EXTS = {".png", ".jpg", ".jpeg", ".webp"}

# 素材规格：kind = sprite（透明、正方形）/ bg（不透明、裁比例）
SPECS = {}
for b in BEASTS["beasts"]:
    SPECS[b["name"]] = {"skin": f"beast_{b['id']}", "kind": "sprite", "size": 384, "group": "异兽"}
SPECS.update({
    "南山背景": {"skin": "bg_battle_nanshan", "kind": "bg", "size": (750, 580), "anchor": "bottom", "group": "背景"},
    "西山背景": {"skin": "bg_battle_xishan", "kind": "bg", "size": (750, 580), "anchor": "bottom", "group": "背景"},
    "北山背景": {"skin": "bg_battle_beidongzhong", "kind": "bg", "size": (750, 580), "anchor": "bottom", "group": "背景"},
    "主界面底图": {"skin": "bg_main", "kind": "bg", "size": (750, 1334), "anchor": "center", "group": "可选"},
    "金币图标": {"skin": "icon_gold", "kind": "sprite", "size": 160, "group": "可选"},
    "进山符图标": {"skin": "icon_ticket", "kind": "sprite", "size": 160, "group": "可选"},
    "战力图标": {"skin": "icon_power", "kind": "sprite", "size": 160, "group": "可选"},
    "签到图标": {"skin": "icon_signin", "kind": "sprite", "size": 160, "group": "可选"},
    "宝箱图标": {"skin": "icon_chest", "kind": "sprite", "size": 160, "group": "可选"},
    "游戏标题": {"skin": "logo", "kind": "sprite", "size": 640, "group": "可选"},
})
BY_SKIN = {v["skin"]: k for k, v in SPECS.items()}


def lookup(stem):
    stem = stem.strip()
    if stem in SPECS:
        return stem, SPECS[stem]
    if stem in BY_SKIN:
        return BY_SKIN[stem], SPECS[BY_SKIN[stem]]
    for name in SPECS:  # 容忍"九尾狐_v2"、"九尾狐 (1)"这类名字
        if stem.startswith(name):
            return name, SPECS[name]
    return None, None


def remove_flat_background(img, tol=38):
    """背景是纯色（不透明）时，从四条边向内把接近背景色的连通区域抠成透明。"""
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    rgb, alpha = a[..., :3], a[..., 3]
    if (alpha < 250).mean() > 0.02:  # 已经有透明背景
        return img.convert("RGBA")
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(-1))
    cand = dist < tol
    reach = np.zeros_like(cand)
    reach[0, :], reach[-1, :], reach[:, 0], reach[:, -1] = cand[0, :], cand[-1, :], cand[:, 0], cand[:, -1]
    while True:  # 在候选像素里从边缘向内扩散（只抠和边缘连通的背景，角色内部的白色不动）
        grown = reach.copy()
        grown[1:] |= reach[:-1]
        grown[:-1] |= reach[1:]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= cand
        if (grown == reach).all():
            break
        reach = grown
    new_alpha = np.where(reach, 0, 255).astype(np.float32)
    # 边缘一圈半透明，减少锯齿
    edge = np.zeros_like(reach)
    edge[1:] |= reach[:-1]
    edge[:-1] |= reach[1:]
    edge[:, 1:] |= reach[:, :-1]
    edge[:, :-1] |= reach[:, 1:]
    edge &= ~reach
    soft = np.clip(dist / (tol * 2.2), 0.35, 1.0) * 255
    new_alpha = np.where(edge, np.minimum(new_alpha, soft), new_alpha)
    out = np.dstack([rgb, new_alpha]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def process_sprite(src, size):
    img = remove_flat_background(Image.open(src))
    alpha = np.asarray(img)[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise ValueError("图片是全透明的")
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = int(max(img.size) * 1.08)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    return canvas.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)


def process_bg(src, size, anchor):
    tw, th = size
    img = Image.open(src).convert("RGB")
    scale = max(tw / img.width, th / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (img.width - tw) // 2
    top = img.height - th if anchor == "bottom" else (img.height - th) // 2
    return img.crop((left, top, left + tw, top + th))


def status():
    have = {p.stem for p in OUT.glob("*") if p.suffix in (".png", ".jpg")}
    groups = {}
    for name, s in SPECS.items():
        groups.setdefault(s["group"], []).append(("✓" if s["skin"] in have else "·") + name)
    for g, items in groups.items():
        done = sum(1 for i in items if i.startswith("✓"))
        print(f"{g}（{done}/{len(items)}）：" + "  ".join(items))


def main():
    global OUT
    ap = argparse.ArgumentParser(description="导入 ChatGPT 生成的美术素材")
    ap.add_argument("--keep", action="store_true", help="原图留在 inbox，不挪走")
    ap.add_argument("--status", action="store_true", help="只看进度")
    ap.add_argument("--inbox", default=str(INBOX))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    if args.status:
        status()
        return
    files = sorted(p for p in Path(args.inbox).iterdir() if p.suffix.lower() in EXTS)
    if not files:
        print(f"{args.inbox} 里没有图片")
    unknown = []
    for src in files:
        name, spec = lookup(src.stem)
        if not spec:
            unknown.append(src.name)
            continue
        try:
            if spec["kind"] == "sprite":
                out = OUT / f"{spec['skin']}.png"
                process_sprite(src, spec["size"]).save(out, optimize=True)
            else:
                out = OUT / f"{spec['skin']}.jpg"
                process_bg(src, spec["size"], spec.get("anchor", "center")).save(out, quality=84, optimize=True, progressive=True)
        except Exception as e:  # noqa: BLE001
            print(f"✗ {src.name}：处理失败（{e}）")
            continue
        print(f"✓ {src.name} → {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}（{out.stat().st_size // 1024}KB）")
        if not args.keep:
            ORIGINALS.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(ORIGINALS / src.name))
    if unknown:
        print("\n认不出的文件名（请按清单的中文名重命名）：" + "，".join(unknown))
    print()
    status()


if __name__ == "__main__":
    sys.exit(main())
