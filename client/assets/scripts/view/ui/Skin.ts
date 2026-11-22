import { Color, Graphics, ImageAsset, JsonAsset, Node, resources, Sprite, SpriteFrame, TTFFont, UITransform } from 'cc';
import { loadDirByName } from './LoadDir';
import { hex, UiFont, uiNode } from './UiKit';

/**
 * 皮肤（美术素材）管理。
 *
 * 所有图片放在 assets/resources/skin/ 下，界面按文件名取图，例如 'btn_red'、'beast_lei'。
 * 默认素材由 tools/art/generate.cjs 生成；有了正式美术，用同名文件覆盖即可，代码不用改。
 * skin.json 里写九宫格边距（inset），用于可拉伸的面板和按钮。
 * 找不到图时用纯色占位，保证界面不会因为缺图而坏掉。
 */
export class Skin {
  static frames: Record<string, SpriteFrame> = {};
  static insets: Record<string, number[]> = {};
  static loaded = false;

  /** 启动时调用一次：读界面字体、skin.json 和 skin/ 下全部图片。 */
  static load(done: () => void): void {
    let pending = 2;
    const finish = () => {
      if (--pending === 0) done();
    };
    resources.load('font/yushou', TTFFont, (e: Error | null, font: TTFFont | null) => {
      if (e || !font) console.warn('[Skin] 读取字体失败，使用系统字体', e);
      else UiFont.font = font;
      finish();
    });
    resources.load('skin/skin', JsonAsset, (e1: Error | null, manifest: JsonAsset | null) => {
      if (!e1 && manifest && manifest.json) {
        const imgs = (manifest.json as { images?: Record<string, { inset?: number[] }> }).images || {};
        for (const k in imgs) if (imgs[k].inset) Skin.insets[k] = imgs[k].inset as number[];
      }
      loadDirByName('skin', ImageAsset, (e2: Error | null, imgs: Record<string, ImageAsset>) => {
        if (e2) console.warn('[Skin] 读取皮肤失败，使用占位', e2);
        for (const name in imgs) {
          const sf = SpriteFrame.createWithImage(imgs[name]);
          const ins = Skin.insets[name];
          if (ins) {
            sf.insetLeft = ins[0];
            sf.insetTop = ins[1];
            sf.insetRight = ins[2];
            sf.insetBottom = ins[3];
          }
          Skin.frames[name] = sf;
        }
        Skin.loaded = true;
        const names = Object.keys(Skin.frames);
        const beasts = names.filter((n) => n.startsWith('beast_')).length;
        console.log(`[Skin] 已加载 ${names.length} 张素材（异兽立绘 ${beasts} 张）`);
        finish();
      });
    });
  }

  static has(name: string): boolean {
    return !!Skin.frames[name];
  }
}

export interface SpriteOptions {
  /** 九宫格拉伸（需要 skin.json 里有 inset）。默认按是否有 inset 自动判断。 */
  sliced?: boolean;
  /** 着色（敌人变暗、未获得变剪影等）。 */
  color?: string;
  alpha?: number;
  /** 缺图时占位色。 */
  fallback?: string;
  /** 缺图时什么也不画（边框、装饰这类可有可无的图）。 */
  optional?: boolean;
}

/** 创建一个显示皮肤图片的节点，尺寸固定为 w × h。 */
export function makeSprite(parent: Node, skinName: string, w: number, h: number, x = 0, y = 0, opts: SpriteOptions = {}): Node {
  const n = uiNode(skinName, parent, x, y);
  setSprite(n, skinName, w, h, opts);
  return n;
}

/** 给已有节点换图（例如页签选中/未选中）。 */
export function setSprite(n: Node, skinName: string, w: number, h: number, opts: SpriteOptions = {}): void {
  const sf = Skin.frames[skinName];
  if (sf) {
    const g = n.getComponent(Graphics);
    if (g) g.clear();
    const sp = n.getComponent(Sprite) || n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    const sliced = opts.sliced === undefined ? !!Skin.insets[skinName] : opts.sliced;
    sp.type = sliced ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
    sp.spriteFrame = sf;
    sp.color = opts.color ? hex(opts.color, opts.alpha === undefined ? 255 : opts.alpha) : new Color(255, 255, 255, opts.alpha === undefined ? 255 : opts.alpha);
  } else if (!opts.optional) {
    const g = n.getComponent(Graphics) || n.addComponent(Graphics);
    g.clear();
    g.fillColor = hex(opts.fallback || '#555b66', opts.alpha === undefined ? 230 : opts.alpha);
    g.roundRect(-w / 2, -h / 2, w, h, Math.min(16, h / 2));
    g.fill();
  }
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);
}

export function setSpriteColor(n: Node, color: string, alpha = 255): void {
  const sp = n.getComponent(Sprite);
  if (sp) sp.color = hex(color, alpha);
}
