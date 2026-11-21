import { _decorator, Component, Graphics, Label, Node, UIOpacity, UITransform } from 'cc';
import { makeSprite, setSpriteColor } from './Skin';
import { hex, makeFullScreen, makeLabel, setLabel, uiNode } from './UiKit';

const { ccclass } = _decorator;

/** 常用界面部件：皮肤按钮、货币条、红点、飘字、提示、弹窗。 */

export type ButtonSkin = 'btn_red' | 'btn_gold' | 'btn_ink' | 'btn_jade';
const BTN_FALLBACK: Record<ButtonSkin, string> = { btn_red: '#b3261e', btn_gold: '#c9a227', btn_ink: '#2a2e36', btn_jade: '#2f8f68' };
const BTN_TEXT: Record<ButtonSkin, string> = { btn_red: '#fff4e0', btn_gold: '#3b2a06', btn_ink: '#f3e6c8', btn_jade: '#f2fff8' };

export interface SkinButton {
  node: Node;
  label: Label;
  sub: Label | null;
  setText(t: string, sub?: string): void;
  setEnabled(on: boolean): void;
}

/** 皮肤按钮。sub 为第二行小字（例如"需 330 金币"）。 */
export function skinButton(
  parent: Node,
  skin: ButtonSkin,
  text: string,
  w: number,
  h: number,
  onTap: () => void,
  x = 0,
  y = 0,
  sub?: string,
): SkinButton {
  const n = makeSprite(parent, skin, w, h, x, y, { fallback: BTN_FALLBACK[skin] });
  const size = Math.round(Math.min(h * 0.36, 40));
  const label = makeLabel(n, text, size, BTN_TEXT[skin], 0, sub !== undefined ? 12 : 4);
  const subLabel = sub !== undefined ? makeLabel(n, sub, Math.round(size * 0.62), BTN_TEXT[skin], 0, -24) : null;
  let enabled = true;
  n.on(Node.EventType.TOUCH_END, () => {
    if (enabled) onTap();
  });
  return {
    node: n,
    label,
    sub: subLabel,
    setText(t: string, s?: string) {
      setLabel(label, t);
      if (subLabel && s !== undefined) setLabel(subLabel, s);
    },
    setEnabled(on: boolean) {
      enabled = on;
      setSpriteColor(n, on ? '#ffffff' : '#8c8c8c');
    },
  };
}

/** 顶栏的货币条：底板 + 左侧图标 + 数字。 */
export function currencyPill(parent: Node, icon: string, x: number, y: number, w = 220): Label {
  const n = makeSprite(parent, 'pill', w, 60, x, y, { fallback: '#16181d', alpha: 210 });
  makeSprite(n, icon, 56, 56, -w / 2 + 30, 0, { fallback: '#c9a227' });
  const l = makeLabel(n, '0', 28, '#fff4d6', 18, 0);
  return l;
}

/** 右上角红点。 */
export function redDot(parent: Node, x: number, y: number): Node {
  const n = uiNode('RedDot', parent, x, y);
  const g = n.addComponent(Graphics);
  g.fillColor = hex('#e53935');
  g.circle(0, 0, 11);
  g.fill();
  g.lineWidth = 3;
  g.strokeColor = hex('#fff4e0');
  g.circle(0, 0, 11);
  g.stroke();
  return n;
}

/** 图标按钮（右侧悬浮的签到、野遇等），带红点和下方小字。 */
export function iconButton(parent: Node, icon: string, size: number, title: string, onTap: () => void, x: number, y: number): { node: Node; dot: Node; title: Label } {
  const n = makeSprite(parent, icon, size, size, x, y, { fallback: '#b3261e' });
  n.on(Node.EventType.TOUCH_END, onTap);
  const t = makeLabel(n, title, 20, '#fff4d6', 0, -size / 2 - 6);
  const bg = t.node.addComponent(Graphics);
  bg.fillColor = hex('#16181d', 170);
  bg.roundRect(-34, -13, 68, 26, 13);
  bg.fill();
  const dot = redDot(n, size / 2 - 10, size / 2 - 10);
  dot.active = false;
  return { node: n, dot, title: t };
}

/** 让文字/节点向上飘并淡出，结束后销毁。 */
@ccclass('Floater')
export class Floater extends Component {
  life = 0.8;
  rise = 60;
  private t = 0;
  private y0 = 0;
  private op: UIOpacity | null = null;

  start(): void {
    this.y0 = this.node.position.y;
    this.op = this.node.getComponent(UIOpacity) || this.node.addComponent(UIOpacity);
  }

  update(dt: number): void {
    this.t += dt;
    const p = Math.min(1, this.t / this.life);
    this.node.setPosition(this.node.position.x, this.y0 + this.rise * (1 - (1 - p) * (1 - p)));
    if (this.op) this.op.opacity = Math.round(255 * (p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4));
    if (p >= 1) this.node.destroy();
  }
}

export function floatText(parent: Node, text: string, x: number, y: number, size: number, color: string, life = 0.8, rise = 60): void {
  const l = makeLabel(parent, text, size, color, x, y);
  const f = l.node.addComponent(Floater);
  f.life = life;
  f.rise = rise;
}

/** 屏幕中上方的提示条，1.6 秒后消失。 */
export function toast(parent: Node, text: string, y = 380): void {
  const n = uiNode('Toast', parent, 0, y);
  const lines = text.split('\n');
  const w = Math.min(680, Math.max(260, Math.max(...lines.map((l) => l.length)) * 28 + 60));
  const h = 40 + lines.length * 36;
  const g = n.addComponent(Graphics);
  g.fillColor = hex('#16181d', 225);
  g.roundRect(-w / 2, -h / 2, w, h, 18);
  g.fill();
  g.lineWidth = 2;
  g.strokeColor = hex('#c9a227', 200);
  g.roundRect(-w / 2, -h / 2, w, h, 18);
  g.stroke();
  makeLabel(n, text, 28, '#fff4d6');
  const f = n.addComponent(Floater);
  f.life = 1.8;
  f.rise = 40;
}

export interface Popup {
  root: Node;
  body: Node;
  close(): void;
}

/** 弹窗：半透明遮罩 + 宣纸面板 + 标题 + 右上角关闭。 */
export function popup(parent: Node, title: string, w: number, h: number, onClose?: () => void): Popup {
  const root = uiNode('Popup', parent);
  const mask = makeFullScreen(root, 'Mask', '#000000', 150);
  mask.on(Node.EventType.TOUCH_START, () => undefined);
  const panel = makeSprite(root, 'panel_paper', w, h, 0, 0, { fallback: '#f3ead6' });
  makeLabel(panel, title, 40, '#3b2a12', 0, h / 2 - 56);
  const body = uiNode('Body', panel, 0, -20);
  const close = () => {
    root.destroy();
    if (onClose) onClose();
  };
  const x = makeSprite(panel, 'btn_ink', 64, 64, w / 2 - 30, h / 2 - 30, { fallback: '#2a2e36' });
  makeLabel(x, '✕', 30, '#f3e6c8');
  x.on(Node.EventType.TOUCH_END, close);
  return { root, body, close };
}

/** 左对齐或右对齐的文字（anchor 0 或 1）。 */
export function alignedLabel(parent: Node, text: string, size: number, color: string, x: number, y: number, align: 'left' | 'right'): Label {
  const l = makeLabel(parent, text, size, color, x, y);
  const ut = l.node.getComponent(UITransform);
  if (ut) ut.setAnchorPoint(align === 'left' ? 0 : 1, 0.5);
  return l;
}
