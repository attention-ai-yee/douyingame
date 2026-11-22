import { Color, Graphics, Label, Layers, Node, TTFFont, UITransform, view } from 'cc';

/**
 * 用代码搭界面的小工具。原型阶段界面都由代码创建，不需要在编辑器里摆节点；
 * 以后美术到位，可以逐步换成预制体。
 *
 * 注意：代码创建的节点必须放在 UI_2D 层，否则 Canvas 的 UI 摄像机看不到。
 */

/** 全局界面字体（resources/font/yushou.ttf，启动时由 Skin.load 加载；没加载到就用系统字体）。 */
export const UiFont: { font: TTFFont | null } = { font: null };

export function hex(c: string, alpha = 255): Color {
  const n = parseInt(c.replace('#', ''), 16);
  return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, alpha);
}

export function uiNode(name: string, parent: Node, x = 0, y = 0): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  parent.addChild(n);
  n.setPosition(x, y);
  return n;
}

export function makeLabel(parent: Node, text: string, size: number, color = '#ffffff', x = 0, y = 0): Label {
  const n = uiNode('Label', parent, x, y);
  const l = n.addComponent(Label);
  if (UiFont.font) {
    l.useSystemFont = false;
    l.font = UiFont.font;
  }
  l.fontSize = size;
  l.lineHeight = Math.round(size * 1.3);
  l.color = hex(color);
  l.string = text;
  return l;
}

export function setLabel(l: Label, text: string, color?: string, alpha = 255): void {
  if (l.string !== text) l.string = text;
  if (color) l.color = hex(color, alpha);
}

export function makeGraphics(parent: Node, name = 'Graphics', x = 0, y = 0): Graphics {
  return uiNode(name, parent, x, y).addComponent(Graphics);
}

export interface Button {
  node: Node;
  label: Label;
}

/** 圆角矩形按钮，点击（抬起）时回调。 */
export function makeButton(parent: Node, text: string, w: number, h: number, color: string, onTap: () => void, x = 0, y = 0): Button {
  const n = uiNode('Button', parent, x, y);
  const g = n.addComponent(Graphics);
  g.fillColor = hex(color, 235);
  g.roundRect(-w / 2, -h / 2, w, h, Math.min(16, h / 2));
  g.fill();
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);
  const label = makeLabel(n, text, Math.round(h * 0.42));
  n.on(Node.EventType.TOUCH_END, onTap);
  return { node: n, label };
}

export function visibleSize(): { width: number; height: number } {
  const s = view.getVisibleSize();
  return { width: s.width, height: s.height };
}

/** 盖住整个屏幕的底板（会吞掉点击，下面的节点收不到）。 */
export function makeFullScreen(parent: Node, name: string, color: string, alpha: number): Node {
  const { width, height } = visibleSize();
  const n = uiNode(name, parent);
  const g = n.addComponent(Graphics);
  g.fillColor = hex(color, alpha);
  g.rect(-width / 2, -height / 2, width, height);
  g.fill();
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(width, height);
  return n;
}

/** 用折线画一段弧（点由 RevealGeometry.arcPoints 给出）。 */
export function strokePolyline(g: Graphics, pts: { x: number; y: number }[], width: number, color: Color): void {
  if (pts.length < 2) return;
  g.lineWidth = width;
  g.strokeColor = color;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.stroke();
}
