import { Graphics, Node } from 'cc';
import { App } from '../../app/App';
import { Rarity } from '../../core';
import { makeSprite, setSpriteColor, Skin } from './Skin';
import { hex, makeLabel, uiNode } from './UiKit';

export interface BeastIconOptions {
  /** 头像框：按稀有度；'enemy' 为红框；null 不要框。默认按异兽稀有度。 */
  frame?: Rarity | 'enemy' | null;
  /** 敌人换色。 */
  enemy?: boolean;
  /** 未获得：显示成剪影。 */
  silhouette?: boolean;
}

export interface BeastIcon {
  node: Node;
  portrait: Node;
  /** 受击闪红等临时着色；normal 恢复。 */
  tint(color: string | 'normal'): void;
}

const OL = '#4a2f27';
const ENEMY_TINT = '#a78bb5';

/**
 * 异兽头像：有立绘（skin/beast_<id>.png）时显示立绘；没有时用五行色圆 + 代表字占位。
 * ChatGPT 出的图导入后会自动替换，不用改代码。
 */
export function makeBeastIcon(parent: Node, beastId: string, size: number, x: number, y: number, opts: BeastIconOptions = {}): BeastIcon {
  const def = App.core.idx.beast[beastId];
  const root = uiNode(`Beast_${beastId}`, parent, x, y);
  const skinName = `beast_${beastId}`;
  const baseTint = opts.silhouette ? '#3b3330' : opts.enemy ? ENEMY_TINT : '#ffffff';
  let portrait: Node;
  if (Skin.has(skinName)) {
    portrait = makeSprite(root, skinName, size, size, 0, 0, { color: baseTint });
  } else {
    portrait = uiNode('Placeholder', root);
    const g = portrait.addComponent(Graphics);
    const el = App.cfg.beasts.elements[def.element];
    g.fillColor = opts.silhouette ? hex('#5a504a') : hex(opts.enemy ? '#8c6fa0' : el.color);
    g.circle(0, 0, size * 0.42);
    g.fill();
    g.lineWidth = Math.max(3, size * 0.04);
    g.strokeColor = hex(OL);
    g.circle(0, 0, size * 0.42);
    g.stroke();
    makeLabel(portrait, opts.silhouette ? '?' : def.glyph || def.name.slice(0, 1), Math.round(size * 0.42), opts.silhouette ? '#cfc4b8' : '#ffffff');
  }
  const frame = opts.frame === undefined ? def.rarity : opts.frame;
  if (frame) {
    const fr = frame === 'enemy' ? 'frame_fan' : `frame_${frame}`;
    makeSprite(root, fr, size * 1.12, size * 1.12, 0, 0, { optional: true, color: frame === 'enemy' ? '#ff6b6b' : undefined });
  }
  return {
    node: root,
    portrait,
    tint(color: string | 'normal') {
      setSpriteColor(portrait, color === 'normal' ? baseTint : color);
    },
  };
}

/** 星级文字：★★★☆☆ */
export function starText(star: number, max = 5): string {
  let s = '';
  for (let i = 0; i < max; i++) s += i < star ? '★' : '☆';
  return s;
}
