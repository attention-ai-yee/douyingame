import { Label, Node } from 'cc';
import { App } from '../../app/App';
import { formatNumber, nextRarity } from '../../core';
import { makeBeastIcon, starText } from '../ui/BeastIcon';
import { makeSprite, Skin } from '../ui/Skin';
import { makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { alignedLabel, popup, skinButton, SkinButton } from '../ui/Widgets';
import { itemName, itemStatText, makeItemIcon } from './ItemIcon';

const OL = '#4a2f27';
const ROLE_TIP: Record<string, string> = { gong: '攻', shou: '守', fu: '辅' };

/**
 * 异兽详情（弹窗）：立绘、星级、等级、战力、技能；升级（金币 + 经验）、升星、装备、上阵/下阵、重置。
 */
export class BeastDetail {
  static open(parent: Node, beastId: string, toast: (t: string) => void, onClose: () => void): BeastDetail {
    return new BeastDetail(parent, beastId, toast, onClose);
  }

  private pop: { root: Node; body: Node; close(): void };
  private dyn: Node;
  private lvBtn!: SkinButton;
  private lv10Btn!: SkinButton;
  private powerL!: Label;
  private resetArmed = 0;

  private constructor(parent: Node, private id: string, private toast: (t: string) => void, onClose: () => void) {
    const def = App.core.idx.beast[id];
    this.pop = popup(parent, def.name, 700, 1120, onClose);
    this.dyn = uiNode('Dyn', this.pop.body);
    this.build();
  }

  private rebuild(): void {
    this.dyn.destroy();
    this.dyn = uiNode('Dyn', this.pop.body);
    this.build();
  }

  private build(): void {
    const core = App.core;
    const id = this.id;
    const def = core.idx.beast[id];
    const b = core.state.beasts[id];
    const body = this.dyn;
    const rar = App.cfg.beasts.rarities[def.rarity];
    const el = App.cfg.beasts.elements[def.element];

    // 立绘 + 基本信息
    if (Skin.has(`beast_${id}`)) makeSprite(body, `beast_${id}`, 300, 300, -150, 330);
    else makeBeastIcon(body, id, 220, -150, 330, {});
    alignedLabel(body, `${rar.name} · ${el.name} · ${ROLE_TIP[def.role]}`, 26, rar.color === '#f2f2f2' ? OL : rar.color, 20, 440, 'left');
    alignedLabel(body, starText(b.star) + (b.shiny ? '  ✦闪光' : ''), 30, '#e8a317', 20, 392, 'left');
    alignedLabel(body, `等级 Lv.${b.level}`, 32, OL, 20, 340, 'left');
    this.powerL = alignedLabel(body, '', 28, '#e53935', 20, 292, 'left');
    alignedLabel(body, def.skill, 22, '#6b5444', 20, 246, 'left');
    makeLabel(body, `「${def.quote}」`, 22, '#8a6d55', 0, 160);

    // 升级
    makeLabel(body, '升级', 28, OL, -270, 92);
    const cost = core.levelCost(id);
    alignedLabel(body, `需 金币 ${formatNumber(cost.gold)} · 经验 ${formatNumber(cost.exp)}`, 22, '#6b5444', -200, 92, 'left');
    this.lvBtn = skinButton(body, 'btn_red', '升 1 级', 280, 92, () => this.onLevel(1), -150, 20);
    this.lv10Btn = skinButton(body, 'btn_red', '升 10 级', 280, 92, () => this.onLevel(10), 150, 20);
    const can = core.canLevelUp(id);
    this.lvBtn.setEnabled(can);
    this.lv10Btn.setEnabled(can);

    // 升星
    const starCost = core.starUpCost(id);
    makeLabel(body, '升星', 28, OL, -270, -70);
    if (starCost === null) {
      const ratio = App.cfg.progression.melt.ratio;
      const to = nextRarity(def.rarity);
      const n = Math.floor(b.shards / ratio);
      if (!to) alignedLabel(body, `已满星 · 星魄 ${b.shards}`, 22, '#6b5444', -200, -70, 'left');
      else {
        alignedLabel(body, `已满星 · 星魄 ${b.shards}（${ratio} 个换 1 个${App.cfg.beasts.rarities[to].name}级万能星魄）`, 20, '#6b5444', -200, -70, 'left');
        const mb = skinButton(body, 'btn_jade', '熔炼', 150, 66, () => this.onMelt(n * ratio), 245, -70);
        mb.setEnabled(n > 0);
      }
    } else {
      const wild = core.state.wildShards[def.rarity];
      alignedLabel(body, `星魄 ${b.shards}/${starCost}（万能 ${wild}）`, 22, '#6b5444', -200, -70, 'left');
      const sb = skinButton(body, 'btn_jade', '升星', 180, 72, () => this.onStar(), 220, -70);
      sb.setEnabled(core.canStarUp(id, true));
    }

    // 装备
    makeLabel(body, '装备', 28, OL, -270, -160);
    skinButton(body, 'btn_gold', '一键穿戴', 200, 66, () => this.onEquipBest(), 220, -160);
    for (let s = 0; s < 4; s++) {
      const x = -255 + s * 170;
      const it = b.equip[s];
      const icon = makeItemIcon(body, it, 96, x, -262, s);
      if (it) {
        icon.on(Node.EventType.TOUCH_END, () => {
          core.unequip(id, s);
          App.save();
          this.toast(`卸下 ${itemName(it)}`);
          this.rebuild();
        });
      }
      makeLabel(body, it ? itemStatText(it) : App.cfg.progression.equip.slots[s].name, 20, it ? OL : '#a08a76', x, -328);
    }
    makeLabel(body, '点装备可以卸下', 18, '#a08a76', 0, -362);

    // 上阵 / 重置
    const onTeam = core.state.team.indexOf(id) >= 0;
    skinButton(body, onTeam ? 'btn_ink' : 'btn_jade', onTeam ? '下阵' : '上阵', 260, 90, () => this.onToggleTeam(), -150, -440);
    const reset = skinButton(body, 'btn_ink', this.resetArmed ? '再点确认重置' : '重置', 260, 90, () => this.onReset(), 150, -440, '返还全部金币经验');
    reset.setEnabled(b.level > 1 || b.equip.some((x) => !!x));
    setLabel(this.powerL, `战力 ${formatNumber(core.unitPower(id))}`);
  }

  private onLevel(n: number): void {
    const got = App.core.levelUp(this.id, n);
    if (!got) {
      this.toast('金币或经验不够，挂机攒一会吧');
      return;
    }
    App.analytics.track('beast_level_up', { beast: this.id, levels: got, level: App.core.state.beasts[this.id].level });
    App.save();
    this.rebuild();
  }

  private onStar(): void {
    if (App.core.starUp(this.id, true)) {
      this.toast(`升到 ${App.core.state.beasts[this.id].star} 星！`);
      App.analytics.track('star_up', { beast: this.id, star: App.core.state.beasts[this.id].star });
      App.save();
      this.rebuild();
    }
  }

  private onMelt(count: number): void {
    const got = App.core.melt(this.id, count);
    if (!got) return;
    App.analytics.track('melt', { beast: this.id, count, got });
    App.save();
    this.toast(`熔炼得到 ${got} 个万能星魄`);
    this.rebuild();
  }

  private onEquipBest(): void {
    const n = App.core.equipBest([this.id]);
    this.toast(n ? `换上了 ${n} 件更好的装备` : '背包里没有更好的装备');
    if (n) {
      App.save();
      this.rebuild();
    }
  }

  private onToggleTeam(): void {
    const core = App.core;
    const team = core.state.team.slice();
    const i = team.indexOf(this.id);
    if (i >= 0) {
      if (core.teamIds().length <= 1) {
        this.toast('至少要留一只异兽上阵');
        return;
      }
      team[i] = null;
    } else {
      const k = core.slotsAvailable();
      let slot = -1;
      for (let j = 0; j < k; j++) if (!team[j]) slot = slot < 0 ? j : slot;
      if (slot < 0) {
        // 阵位满了：替换掉战力最低的
        let worst = 0;
        for (let j = 1; j < k; j++) if (core.unitPower(team[j] as string) < core.unitPower(team[worst] as string)) worst = j;
        slot = worst;
        this.toast(`替换下 ${core.idx.beast[team[slot] as string].name}（可以重置它，把金币经验返还回来）`);
      }
      team[slot] = this.id;
    }
    core.setTeam(team);
    App.save();
    this.rebuild();
  }

  private onReset(): void {
    if (!this.resetArmed || Date.now() - this.resetArmed > 3000) {
      this.resetArmed = Date.now();
      this.rebuild();
      return;
    }
    this.resetArmed = 0;
    const r = App.core.resetBeast(this.id);
    if (r) this.toast(`已重置，返还 金币 ${formatNumber(r.gold)} · 经验 ${formatNumber(r.exp)}`);
    App.save();
    this.rebuild();
  }
}
