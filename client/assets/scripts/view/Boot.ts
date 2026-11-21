import { _decorator, Component, JsonAsset, Label, Node, resources } from 'cc';
import { App } from '../app/App';
import { formatNumber } from '../core';

const { ccclass, property } = _decorator;

/**
 * 启动组件：挂在首个场景的 Canvas 节点上。
 * 1. 加载 resources/config 下的全部配置表，交给 App.boot()；
 * 2. 每帧驱动 App.update()（在线挂机、自动存档）；
 * 3. 开发期显示一个调试面板；勾选 autoPlay 后每秒自动升级、推图、爬塔，用来确认逻辑在跑。
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

  private autoTimer = 0;

  start(): void {
    if (this.showDebug && !this.debugLabel) this.debugLabel = this.createDebugLabel();
    resources.loadDir('config', JsonAsset, (err: Error | null, assets: JsonAsset[]) => {
      if (err) {
        console.error('[Boot] 加载配置表失败', err);
        if (this.debugLabel) this.debugLabel.string = '加载配置表失败：' + err.message;
        return;
      }
      const files: Record<string, unknown> = {};
      for (const a of assets) files[a.name] = a.json;
      App.boot(files);
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
    }
    if (this.debugLabel) this.debugLabel.string = this.debugText();
  }

  onDestroy(): void {
    App.save();
  }

  private autoStep(): void {
    const core = App.core;
    if (core.canFreeTenPull()) {
      const m = core.mountains().filter((x) => x.unlocked).pop();
      if (m) core.pull(m.id, 10);
    }
    while (core.revealQueue.length) core.finishReveal(core.revealQueue[0], App.cfg.reveal.skipSeals);
    for (const id of Object.keys(core.state.beasts)) while (core.starUp(id, true));
    core.autoTeam();
    core.upgradeCheapest();
    while (core.challengeStage().win);
    if (core.towerUnlocked()) while (core.challengeFloor().win);
    App.save();
  }

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
    ];
    if (App.configErrors.length) lines.push(`配置错误 ${App.configErrors.length} 条，见控制台`);
    return lines.join('\n');
  }

  private createDebugLabel(): Label {
    const node = new Node('DebugLabel');
    this.node.addChild(node);
    node.setPosition(0, 300);
    const label = node.addComponent(Label);
    label.fontSize = 24;
    label.lineHeight = 34;
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
    label.string = '加载中…';
    return label;
  }
}
