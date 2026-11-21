import { Node } from 'cc';
import { App } from '../../app/App';
import { formatNumber, RARITIES } from '../../core';
import { makeLabel, uiNode } from '../ui/UiKit';
import { popup, skinButton } from '../ui/Widgets';
import { itemName, itemStatText, makeItemIcon } from './ItemIcon';

/** 装备背包：按品质排序列出背包里的装备；一键穿戴（上阵异兽）、一键分解（凡、灵品质）。点装备单个分解。 */
export class BagPopup {
  static open(parent: Node, toast: (t: string) => void, onClose: () => void): BagPopup {
    return new BagPopup(parent, toast, onClose);
  }

  private pop: { root: Node; body: Node; close(): void };
  private grid: Node;

  private constructor(parent: Node, private toast: (t: string) => void, onClose: () => void) {
    this.pop = popup(parent, '装备背包', 700, 1120, onClose);
    this.grid = uiNode('Grid', this.pop.body);
    skinButton(this.pop.body, 'btn_gold', '一键穿戴', 280, 90, () => this.onEquipBest(), -150, -470, '给上阵的异兽');
    skinButton(this.pop.body, 'btn_ink', '一键分解', 280, 90, () => this.onDismantle(), 150, -470, '分解凡、灵品质');
    this.build();
  }

  private build(): void {
    this.grid.destroy();
    this.grid = uiNode('Grid', this.pop.body);
    const core = App.core;
    const bag = core.state.bag.slice().sort((a, b) => core.itemPct(b) - core.itemPct(a) || RARITIES.indexOf(b.q) - RARITIES.indexOf(a.q));
    makeLabel(this.grid, `${bag.length}/${App.cfg.progression.equip.bagCap} 件 · 点装备可以分解`, 22, '#8a6d55', 0, 470);
    if (!bag.length) {
      makeLabel(this.grid, '背包是空的\n挂机宝箱和 Boss 关会掉装备', 28, '#8a6d55', 0, 120).lineHeight = 44;
      return;
    }
    const cols = 5;
    const cw = 124;
    const show = bag.slice(0, 30);
    show.forEach((it, i) => {
      const x = (i % cols - (cols - 1) / 2) * cw;
      const y = 380 - Math.floor(i / cols) * 140;
      const icon = makeItemIcon(this.grid, it, 92, x, y);
      icon.on(Node.EventType.TOUCH_END, () => {
        const g = core.dismantleOne(it.id);
        App.save();
        this.toast(`分解 ${itemName(it)}，得到 ${formatNumber(g)} 金币`);
        this.build();
      });
      makeLabel(this.grid, itemStatText(it), 18, '#4a2f27', x, y - 60);
    });
    if (bag.length > show.length) makeLabel(this.grid, `还有 ${bag.length - show.length} 件没显示`, 20, '#a08a76', 0, 380 - 6 * 140 + 40);
  }

  private onEquipBest(): void {
    const n = App.core.equipBest();
    this.toast(n ? `换上了 ${n} 件更好的装备` : '上阵异兽已经穿着最好的了');
    if (n) App.save();
    this.build();
  }

  private onDismantle(): void {
    const r = App.core.dismantleBag('xi');
    this.toast(r.count ? `分解 ${r.count} 件，得到 ${formatNumber(r.gold)} 金币` : '没有凡、灵品质的装备');
    if (r.count) App.save();
    this.build();
  }
}
