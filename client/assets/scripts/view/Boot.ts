import { _decorator, Canvas, Component, JsonAsset, resources } from 'cc';
import { App } from '../app/App';
import { formatNumber, PendingReveal, RevealReward } from '../core';
import { MainView } from './main/MainView';
import { RevealView } from './reveal/RevealView';
import { Skin } from './ui/Skin';

const { ccclass, property } = _decorator;

const SOURCE_TEXT: Record<string, string> = {
  pull: '进山 · 异兽现身！',
  wild: '野生异兽出现了！',
  boss: 'Boss 收服',
  signin: '签到 · 师父留下的灵兽',
};

/**
 * 启动组件：挂在首个场景的 Canvas 节点上。
 * 1. 并行加载 resources/config（配置表）和 resources/skin（美术素材），然后 App.boot()；
 * 2. 打开主界面 MainView；
 * 3. 有待拍符的异兽时弹出现身拍符界面（autoPlay 关闭时）；
 * 4. autoPlay（开发用）：每秒自动领奖、抽兽、升星、升级、推图、爬塔，会自动跳过拍符。
 *    也可以在游戏里「更多」页签开关。
 */
@ccclass('Boot')
export class Boot extends Component {
  @property
  autoPlay = false;

  /** 勾选后每次启动都清档，从零开始（反复测新手流程用，测完记得取消）。 */
  @property
  resetSaveOnStart = false;

  private autoTimer = 0;
  private reveal: RevealView | null = null;
  private main: MainView | null = null;

  start(): void {
    console.log('[Boot] 开始启动');
    if (!this.node.getComponent(Canvas)) console.warn('[Boot] Boot 没有挂在 Canvas 节点上，界面可能显示不出来');
    let files: Record<string, unknown> | null = null;
    let skinDone = false;
    const tryBoot = () => {
      if (!files || !skinDone || App.ready) return;
      App.boot(files, undefined, { resetSave: this.resetSaveOnStart });
      console.log(`[Boot] 启动完成：平台 ${App.platform.name}，关卡 ${App.core.state.stage}，配置错误 ${App.configErrors.length} 条`);
      this.main = MainView.open(this.node, {
        openPractice: () => this.openPractice(),
        getAutoPlay: () => this.autoPlay,
        setAutoPlay: (on: boolean) => {
          this.autoPlay = on;
        },
      });
    };
    resources.loadDir('config', JsonAsset, (err: Error | null, assets: JsonAsset[]) => {
      if (err) {
        console.error('[Boot] 加载配置表失败', err);
        return;
      }
      const f: Record<string, unknown> = {};
      for (const a of assets) f[a.name] = a.json;
      files = f;
      tryBoot();
    });
    Skin.load(() => {
      skinDone = true;
      tryBoot();
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

  // ------------------------------------------------------------ 自动模式（开发用）

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
}

function describeReward(r: RevealReward): string {
  const parts = ['收服！'];
  if (r.dianjing) parts.push('点睛成功：变为闪光！');
  if (r.shards > 0) parts.push(`星魄 +${r.shards}`);
  if (r.gold > 0) parts.push(`金币 +${formatNumber(r.gold)}`);
  if (r.seals < 2) parts.push('（2 印得金币，3 印得星魄并有机会点睛）');
  return parts.join('\n');
}

