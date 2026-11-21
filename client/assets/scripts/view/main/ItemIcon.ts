import { Graphics, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { Item } from '../../core';
import { makeSprite } from '../ui/Skin';
import { hex, makeLabel, uiNode } from '../ui/UiKit';

const OL = '#4a2f27';
/** 装备品质底色（浅）和边框色（深），沿用稀有度配色。 */
const Q_BG: Record<string, string> = { fan: '#f1ece4', ling: '#dcefff', xi: '#efe2ff', chuanshuo: '#fff1c2' };
const Q_LINE: Record<string, string> = { fan: '#a89b8a', ling: '#4a90e2', xi: '#9b59b6', chuanshuo: '#f5a623' };

export function itemName(it: Item): string {
  const q = App.cfg.beasts.rarities[it.q].name;
  return `${q}·${App.cfg.progression.equip.slots[it.slot].name}`;
}

export function itemStatText(it: Item): string {
  const stat = App.cfg.progression.equip.slots[it.slot].stat === 'atk' ? '攻击' : '生命';
  return `${stat} +${Math.round(App.core.itemPct(it) * 1000) / 10}%`;
}

/** 装备格子：品质色底 + 部位图标 + 阶数；it 为 null 时画空格子（slot 指定部位）。 */
export function makeItemIcon(parent: Node, it: Item | null, size: number, x: number, y: number, slot = 0): Node {
  const n = uiNode('Item', parent, x, y);
  const g = n.addComponent(Graphics);
  const q = it ? it.q : 'fan';
  g.fillColor = hex(it ? Q_BG[q] : '#efe7db');
  g.roundRect(-size / 2, -size / 2, size, size, size * 0.2);
  g.fill();
  g.lineWidth = Math.max(3, size * 0.05);
  g.strokeColor = hex(it ? Q_LINE[q] : '#c9b8a2');
  g.roundRect(-size / 2, -size / 2, size, size, size * 0.2);
  g.stroke();
  makeSprite(n, `equip_${it ? it.slot : slot}`, size * 0.72, size * 0.72, 0, 0, { optional: true, color: it ? undefined : '#bdb2a4' });
  if (it) makeLabel(n, `${it.tier}阶`, Math.round(size * 0.22), OL, size * 0.22, -size * 0.32);
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(size, size);
  return n;
}
