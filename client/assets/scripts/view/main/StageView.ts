import { _decorator, Component, Label, Node } from 'cc';
import { App } from '../../app/App';
import { ChallengeResult, FloorReward, formatNumber, Item, StageReward } from '../../core';
import { makeSprite } from '../ui/Skin';
import { makeFullScreen, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';
import { skinButton, toast } from '../ui/Widgets';
import { BattleView } from './BattleView';
import { itemName, makeItemIcon } from './ItemIcon';

const { ccclass } = _decorator;
const OL = '#4a2f27';

export interface StageViewHooks {
  /** 关闭闯关界面（goUpgrade 为 true 表示玩家点了"去升级"）。 */
  onClose(goUpgrade: boolean): void;
}

/**
 * 进山闯关界面（全屏）：上方显示关卡和双方战力，中间打一场，下方结算。
 * 赢了：首通奖励（金币、经验、寻兽符、Boss 装备），可以接着打下一关；
 * 输了：召唤助战（看视频，本场战力 ×1.3）、去升级、返回。
 */
@ccclass('StageView')
export class StageView extends Component {
  static open(parent: Node, kind: 'stage' | 'tower', hooks: StageViewHooks): StageView {
    const n = uiNode('StageView', parent);
    const v = n.addComponent(StageView);
    v.setup(kind, hooks);
    return v;
  }

  private kind: 'stage' | 'tower' = 'stage';
  private hooks!: StageViewHooks;
  private battle!: BattleView;
  private titleL!: Label;
  private powerL!: Label;
  private panel: Node | null = null;
  private H = 1334;
  private W = 750;

  private setup(kind: 'stage' | 'tower', hooks: StageViewHooks): void {
    this.kind = kind;
    this.hooks = hooks;
    const vs = visibleSize();
    this.W = vs.width;
    this.H = vs.height;
    const top = this.H / 2;
    const mask = makeFullScreen(this.node, 'Mask', '#2b211c', 250);
    mask.on(Node.EventType.TOUCH_START, () => undefined);
    const head = makeSprite(this.node, 'pill', this.W - 50, 80, 0, top - 70, { fallback: '#fffaf0' });
    this.titleL = makeLabel(head, '', 32, OL, 0, 0);
    this.powerL = makeLabel(this.node, '', 26, '#fff4d6', 0, top - 150);
    this.battle = BattleView.create(this.node, this.W, 580, 0, top - 480, { kind }, { onResult: (r) => this.onResult(r) });
    skinButton(this.node, 'btn_ink', '返回', 200, 80, () => this.close(false), -this.W / 2 + 130, -this.H / 2 + 90);
    this.refreshHeader();
    this.battle.startChallenge(false);
  }

  private refreshHeader(): void {
    const core = App.core;
    let enemy = 0;
    if (this.kind === 'stage') {
      const next = core.nextStage();
      if (!next) {
        setLabel(this.titleL, '主线已全部通关');
        return;
      }
      const ch = App.cfg.stages.chapters[next.chapter - 1];
      const local = next.stage - (next.chapter - 1) * App.cfg.stages.chapterLength;
      const tag = next.isChapterBoss ? ` · ${ch.boss.name}` : next.isSmallBoss ? ' · 小 Boss' : '';
      setLabel(this.titleL, `${ch.name.split('·')[0]} · 第 ${local} 关${tag}`);
      enemy = next.enemyPower;
    } else {
      setLabel(this.titleL, `镇妖塔 · 第 ${core.state.floor + 1} 层`);
      enemy = core.nextFloorPower();
    }
    setLabel(this.powerL, `我方战力 ${formatNumber(core.teamPower())}　·　敌方 ${formatNumber(enemy)}`);
  }

  private onResult(res: ChallengeResult): void {
    const ev = this.kind === 'tower' ? (res.win ? 'tower_win' : 'tower_fail') : res.win ? 'stage_win' : 'stage_fail';
    App.analytics.track(ev, {
      kind: this.kind,
      stage: App.core.state.stage,
      floor: App.core.state.floor,
      power: Math.round(res.power),
      enemyPower: Math.round(res.enemyPower),
    });
    if (res.win) App.save();
    this.scheduleOnce(() => (res.win ? this.showWin() : this.showFail(res)), 0.5);
  }

  private clearPanel(): void {
    if (this.panel) this.panel.destroy();
    this.panel = null;
  }

  private showWin(): void {
    this.clearPanel();
    const core = App.core;
    const y = this.H / 2 - 960;
    const p = makeSprite(this.node, 'panel_paper', this.W - 60, 420, 0, y, { fallback: '#fff8ea' });
    this.panel = p;
    makeLabel(p, '胜利！', 52, '#e53935', 0, 150);
    const last = this.kind === 'stage' ? this.lastStageReward : null;
    const lines: string[] = [];
    if (this.kind === 'stage' && last) {
      lines.push(`金币 +${formatNumber(last.gold)}　经验 +${formatNumber(last.exp)}`);
      if (last.tickets) lines.push(`寻兽符 +${last.tickets}`);
    } else if (this.kind === 'tower' && this.lastFloorReward) {
      const r = this.lastFloorReward;
      lines.push(`金币 +${formatNumber(r.gold)}　经验 +${formatNumber(r.exp)}`);
      if (r.tickets) lines.push(`寻兽符 +${r.tickets}`);
      if (r.wild.ling) lines.push(`灵级万能星魄 +${r.wild.ling}`);
      if (r.wild.xi) lines.push(`稀级万能星魄 +${r.wild.xi}`);
    }
    makeLabel(p, lines.join('\n'), 28, OL, 0, 70).lineHeight = 40;
    if (last && last.item) this.showItem(p, last.item, 0, -20);
    if (this.kind === 'stage' && (core.state.stage === 10 || core.state.stage === 40)) toast(this.node, `开放第 ${core.slotsAvailable()} 个上阵位！`, this.H / 2 - 260);
    if (last && last.captureBeast) toast(this.node, `收服了 ${core.idx.beast[last.captureBeast].name}！`, this.H / 2 - 320);
    const hasNext = this.kind === 'tower' || !!core.nextStage();
    skinButton(p, 'btn_ink', '返回', 220, 92, () => this.close(false), -150, -140);
    if (hasNext) skinButton(p, 'btn_red', this.kind === 'tower' ? '下一层' : '下一关', 260, 92, () => this.again(false), 140, -140);
  }

  private showItem(parent: Node, it: Item, x: number, y: number): void {
    makeItemIcon(parent, it, 84, x - 120, y);
    makeLabel(parent, `获得装备：${itemName(it)}`, 26, OL, x + 50, y);
  }

  private showFail(res: ChallengeResult): void {
    this.clearPanel();
    const y = this.H / 2 - 960;
    const p = makeSprite(this.node, 'panel_ink', this.W - 60, 420, 0, y, { fallback: '#17191e', alpha: 245 });
    this.panel = p;
    makeLabel(p, '挑战失败', 48, '#ff8a65', 0, 150);
    makeLabel(p, `我方战力 ${formatNumber(res.power)}　敌方 ${formatNumber(res.enemyPower)}\n给异兽升级、换上更好的装备再来`, 26, '#f3e6c8', 0, 76).lineHeight = 38;
    const ads = App.ads;
    const left = ads.remaining('assist');
    const canAssist = ads.available('assist');
    const b1 = skinButton(p, 'btn_gold', '召唤助战', 300, 100, () => this.onAssist(), -160, -40, `看视频 · 战力×${App.cfg.progression.assist.powerMult}`);
    b1.setEnabled(canAssist);
    if (canAssist) ads.markOffered('assist');
    skinButton(p, 'btn_red', '去升级', 300, 100, () => this.close(true), 160, -40);
    makeLabel(p, left === null ? '' : `今日助战剩余 ${left} 次`, 22, '#9aa3b2', -160, -112);
    skinButton(p, 'btn_ink', '返回', 220, 80, () => this.close(false), 160, -150);
  }

  private async onAssist(): Promise<void> {
    const r = await App.ads.showRewarded('assist');
    if (!r.granted) {
      toast(this.node, r.status === 'skipped' ? '没有看完视频，不能召唤助战' : '暂时没有广告，稍后再试', this.H / 2 - 260);
      return;
    }
    this.again(true);
  }

  private again(assist: boolean): void {
    this.clearPanel();
    this.refreshHeader();
    this.battle.startChallenge(assist);
  }

  private close(goUpgrade: boolean): void {
    this.node.destroy();
    this.hooks.onClose(goUpgrade);
  }

  // core 发出的通关事件里带奖励，这里记下来给结算面板用
  private lastStageReward: StageReward | null = null;
  private lastFloorReward: FloorReward | null = null;
  private offStage: (() => void) | null = null;
  private offFloor: (() => void) | null = null;

  onLoad(): void {
    this.offStage = App.core.events.on('stageCleared', (e) => (this.lastStageReward = e.reward));
    this.offFloor = App.core.events.on('floorCleared', (e) => (this.lastFloorReward = e.reward));
  }

  onDestroy(): void {
    if (this.offStage) this.offStage();
    if (this.offFloor) this.offFloor();
  }
}
