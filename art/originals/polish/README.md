# 御兽山海美术更新

这里保存本批 ImageGen 原图。游戏使用 [skin 目录](../../../client/assets/resources/skin)里的裁切、缩放和压缩版。

| 原图 | 游戏素材 | 用途 |
| --- | --- | --- |
| `battle-*.png` | `bg_battle_*.jpg` | 三章战场，750 × 580 |
| `home-*.png` | `bg_home_*.jpg` | 全屏挂机竖版战场，750 × 1164，由 `tools/art/home_bg.py` 导入 |
| `mountain-*.png` | `bg_mountain_*.jpg` | 三张进山地图横幅，690 × 184 |
| `main-paper.png`、`reveal-sanctum.png` | `bg_main.jpg`、`bg_reveal.jpg` | 竖屏纸底、寻兽和拍符场景 |
| `summon-card.png` | `pull_card_back.png` | 寻兽揭晓卡背，稀有度由卡边颜色显示 |
| `navigation.png`、`reward-icons.png`、`daily-icons.png` | `nav_*.png`、`icon_*.png`、`chest_box*.png` | 页签、资源、日常入口和宝箱 |
| `element-fx.png` | `fx_hit_*.png` | 木、火、土、金、水的命中特效 |
| `anim-*.png` | `battle_lei.png`、`battle_jiuweihu.png`、`battle_huahuai.png` | 类、九尾狐、猾褢的战斗动作 |

战斗图集为等宽的 3 列 × 2 行，每格 160 × 160。按行读为两帧待机、蓄力、出招、收招、受击，统一朝右。类的原图下排前两帧以 x=536 切分，再排入等宽图集。动画帧使用统一缩放和脚底基线。

场景用青绿山水和矿物色铺陈，战场中央留出低对比度的站位区。界面图标沿用深棕细描边，配色取玉石、朱漆和黄铜。动作图集按对应立绘的颜色、体态和饰件设计。
