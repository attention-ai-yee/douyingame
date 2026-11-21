import { _decorator, Canvas, Component, game, Graphics, JsonAsset, Label, Node, resources } from 'cc';
import { App } from '../app/App';
import { formatNumber, PendingReveal, RevealReward } from '../core';
import { RevealView } from './reveal/RevealView';
import { hex, makeButton, makeLabel, uiNode } from './ui/UiKit';

const { ccclass, property } = _decorator;

const SOURCE_TEXT: Record<string, string> = {
  pull: '进山 · 异兽现身！',
  wild: '野生异兽出现了！',
  boss: 'Boss 收服',
  signin: '签到 · 师父留下的灵兽',
};

/**
 * 启动组件：挂在首个场景的 Canvas 节点上。
 * 1. 加载 resources/config 下的全部配置表，交给 App.boot()；
 * 2. 每帧驱动 App.update()（在线挂机、自动存档）；
 * 3. 有待拍符的异兽时弹出现身拍符界面（autoPlay 关闭时）；
 * 4. 开发期显示调试面板：清档重开、拍符练习；勾选 autoPlay 后每秒自动升级、推图、爬塔（会自动跳过拍符）。
 *
 * 这个文件依赖 Cocos（import 'cc'），没有放进根目录的 typecheck；在 Cocos Creator 里打开工程时编译。
 */
@ccclass('Boot')
export class Boot extends Component {
  @property(Label)
  debugLabel: Label | null = null;

  @property
  showDebug = true;

  @property
  autoPlay = false;

  /** 勾选后每次启动都清档，从零开始（反复测新手流程用，测完记得取消）。 */
  @property
  resetSaveOnStart = false;

  private autoTimer = 0;
  private resetArmed = false;
  private resetLabel: Label | null = null;
  private reveal: RevealView | null = null;

  start(): void {
    console.log('[Boot] 开始启动');
    if (!this.node.getComponent(Canvas)) console.warn('[Boot] Boot 没有挂在 Canvas 节点上，界面可能显示不出来');
    if (this.showDebug && !this.debugLabel) this.debugLabel = this.createDebugPanel();
    resources.loadDir('config', JsonAsset, (err: Error | null, assets: JsonAsset[]) => {
      if (err) {
        console.error('[Boot] 加载配置表失败', err);
        if (this.debugLabel) this.debugLabel.string = '加载配置表失败：' + err.message;
        return;
      }
      const files: Record<string, unknown> = {};
      for (const a of assets) files[a.name] = a.json;
      console.log(`[Boot] 已加载配置表：${Object.keys(files).join(', ')}`);
      App.boot(files, undefined, { resetSave: this.resetSaveOnStart });
      console.log(`[Boot] 启动完成：平台 ${App.platform.name}，关卡 ${App.core.state.stage}，配置错误 ${App.configErrors.length} 条`);
    });
  }

  update(dt: number): void {
    if (!App.ready) return;
    App.update(dt);
    if (this.autoPlay) {
      this.autoTimer += dt;
      if (this.autoTimer >= 1) {
        this.autoTimer = 0;
        this.autoStep();
      }
    } else if (!this.reveal && App.core.revealQueue.length) {
      this.openQueuedReveal(App.core.revealQueue[0]);
    }
    if (this.debugLabel) this.debugLabel.string = this.debugText();
  }

  onDestroy(): void {
    App.save();
  }

  // ------------------------------------------------------------ 现身拍符

  private openQueuedReveal(p: PendingReveal): void {
    const core = App.core;
    this.reveal = RevealView.open(this.node, {
      beast: core.idx.beast[p.beastId],
      isBoss: p.isBoss,
      shiny: p.shiny,
      practice: false,
      session: core.createRevealSession(p),
      sourceText: SOURCE_TEXT[p.source] || '异兽现身！',
      onSettle: (seals) => {
        const r = core.finishReveal(p, seals);
        App.save();
        return describeReward(r);
      },
      onClose: () => {
        this.reveal = null;
      },
    });
  }

  private openPractice(): void {
    if (this.reveal || !App.ready) return;
    const list = App.cfg.beasts.beasts;
    this.reveal = RevealView.open(this.node, {
      beast: list[0],
      isBoss: false,
      shiny: false,
      practice: true,
      practiceList: list,
      onClose: () => {
        this.reveal = null;
      },
    });
  }

  // ------------------------------------------------------------ 自动模式

  private autoStep(): void {
    const core = App.core;
    core.claimOffline(1);
    if (core.canClaimSignin()) {
      const r = core.idx.cfg.signin.firstRound;
      const today = r[core.state.signin.claimedInRound % r.length];
      core.claimSignin(today.choice ? today.choice[0] : undefined);
    }
    core.claimStoredWild();
    if (core.canFreeTenPull()) {
      const m = core.mountains().filter((x) => x.unlocked).pop();
      if (m) core.pull(m.id, 10);
    }
    if (!this.reveal) while (core.revealQueue.length) core.finishReveal(core.revealQueue[0], App.cfg.reveal.skipSeals);
    for (const id of Object.keys(core.state.beasts)) while (core.starUp(id, true));
    core.autoTeam();
    core.upgradeCheapest();
    while (core.challengeStage().win);
    if (core.towerUnlocked()) while (core.challengeFloor().win);
    App.save();
  }

  // ------------------------------------------------------------ 调试面板

  private debugText(): string {
    const core = App.core;
    const s = core.state;
    const next = core.nextStage();
    const lines = [
      `【御兽山海 调试面板】平台：${App.platform.name}`,
      `关卡 ${s.stage}  下一关敌方 ${next ? formatNumber(next.enemyPower) : '-'}`,
      `镇妖塔 ${s.floor} 层${core.towerUnlocked() ? '' : '（未解锁）'}`,
      `战力 ${formatNumber(core.teamPower())}  阵位 ${s.slotLevels.slice(0, core.slotsAvailable()).join('/')}`,
      `金币 ${formatNumber(s.gold)}  每分钟 ${formatNumber(core.goldPerMin())}`,
      `进山符 ${s.tickets}  图鉴 ${Object.keys(s.beasts).length}/${App.cfg.beasts.beasts.length}`,
      `待拍符 ${core.revealQueue.length}  离线待领 ${s.pendingOffline ? formatNumber(s.pendingOffline.gold) : 0}`,
      this.autoPlay ? '自动模式：开（会自动跳过拍符）' : '自动模式：关',
    ];
    if (App.configErrors.length) lines.push(`配置错误 ${App.configErrors.length} 条，见控制台`);
    return lines.join('\n');
  }

  /**
   * 代码创建的节点默认在 DEFAULT 层，而 Canvas 的 UI 摄像机只渲染 UI_2D 层，
   * 所以都通过 UiKit.uiNode 创建（会设成 UI_2D）。
   */
  private createDebugPanel(): Label {
    const panel = uiNode('DebugPanel', this.node, 0, 150);
    const bg = panel.addComponent(Graphics);
    bg.fillColor = hex('#000000', 180);
    bg.roundRect(-340, -185, 680, 370, 16);
    bg.fill();
    const label = makeLabel(panel, '加载中…', 26, '#ffffff');
    label.lineHeight = 40;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;

    const reset = makeButton(panel, '清档重开', 260, 64, '#b43232', () => this.onResetTap(), -140, -235);
    this.resetLabel = reset.label;
    makeButton(panel, '拍符练习', 260, 64, '#2e7d32', () => this.openPractice(), 140, -235);
    return label;
  }

  /** "清档重开"：点两次确认，防止误触。 */
  private onResetTap(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      if (this.resetLabel) this.resetLabel.string = '再点一次确认';
      this.scheduleOnce(() => {
        this.resetArmed = false;
        if (this.resetLabel) this.resetLabel.string = '清档重开';
      }, 3);
      return;
    }
    console.log('[Boot] 清档重开');
    App.resetAndRestart(() => {
      if (App.platform.name === 'web' && typeof location !== 'undefined') location.reload();
      else game.restart();
    });
  }
}

function describeReward(r: RevealReward): string {
  const parts = ['收服！'];
  if (r.dianjing) parts.push('点睛成功：变为闪光！');
  if (r.shards > 0) parts.push(`星魄 +${r.shards}`);
  if (r.gold > 0) parts.push(`金币 +${formatNumber(r.gold)}`);
  if (r.seals < 2) parts.push('（2 印得金币，3 印得星魄并有机会点睛）');
  return parts.join('\n');
}
