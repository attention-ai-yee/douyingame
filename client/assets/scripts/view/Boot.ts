import { _decorator, Camera, Canvas, Color, Component, director, Director, JsonAsset, Layers, Node, ResolutionPolicy, UITransform, view } from 'cc';
import { EDITOR } from 'cc/env';
import { App } from '../app/App';
import { formatNumber, PendingReveal, RevealReward } from '../core';
import { MainView } from './main/MainView';
import { RevealView } from './reveal/RevealView';
import { loadDirByName } from './ui/LoadDir';
import { Skin } from './ui/Skin';

const { ccclass, property } = _decorator;

const SOURCE_TEXT: Record<string, string> = {
  pull: '寻兽 · 异兽现身！',
  wild: '野生异兽出现了！',
  boss: 'Boss 收服',
  signin: '签到 · 师父留下的灵兽',
};

/** 设计分辨率：竖屏 750×1334，按宽度适配。用代码设置，不依赖项目设置（项目设置丢了也不会变形）。 */
export function applyDesignResolution(): void {
  view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
}

/** 找到场景里的 Canvas；没有就用代码建一个（带一台只拍 UI 的正交相机）。 */
export function ensureCanvas(): Canvas | null {
  const scene = director.getScene();
  if (!scene) return null;
  const found = scene.getComponentInChildren(Canvas);
  if (found) return found;
  const node = new Node('Canvas');
  node.layer = Layers.Enum.UI_2D;
  scene.addChild(node);
  const vs = view.getVisibleSize();
  node.addComponent(UITransform).setContentSize(vs.width, vs.height);
  const camNode = new Node('UICamera');
  camNode.layer = Layers.Enum.UI_2D;
  node.addChild(camNode);
  camNode.setPosition(0, 0, 1000);
  const cam = camNode.addComponent(Camera);
  cam.projection = Camera.ProjectionType.ORTHO;
  cam.near = 0;
  cam.far = 2000;
  cam.priority = 1 << 30;
  cam.visibility = Layers.Enum.UI_2D;
  cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
  cam.clearColor = new Color(43, 33, 28, 255);
  const canvas = node.addComponent(Canvas);
  canvas.cameraComponent = cam;
  canvas.alignCanvasWithScreen = true;
  console.warn('[Boot] 场景里没有 Canvas，已用代码创建');
  return canvas;
}

/**
 * 场景加载后检查有没有 Boot：没有（例如本地场景丢了、新建的空场景、Boot 脚本丢失）就自动挂到 Canvas 上。
 * 这样任何场景都能直接运行游戏，不依赖手工搭的场景。编辑器里不执行，免得改动正在编辑的场景。
 */
function autoBoot(): void {
  const scene = director.getScene();
  if (!scene || scene.getComponentInChildren(Boot)) return;
  const canvas = ensureCanvas();
  if (!canvas) return;
  console.warn('[Boot] 当前场景没有挂 Boot 组件，已自动挂到 Canvas 上');
  canvas.node.addComponent(Boot);
}

/**
 * 启动组件：挂在首个场景的 Canvas 节点上（没挂也行，见 autoBoot）。
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
    applyDesignResolution();
    if (!this.node.getComponent(Canvas)) {
      // 挂错了节点：挪到 Canvas 上（没有 Canvas 就建一个），界面才显示得出来
      const canvas = ensureCanvas();
      if (canvas && canvas.node !== this.node) {
        console.warn('[Boot] Boot 没有挂在 Canvas 节点上，已自动挪到 Canvas');
        const b = canvas.node.getComponent(Boot) || canvas.node.addComponent(Boot);
        b.autoPlay = this.autoPlay;
        b.resetSaveOnStart = this.resetSaveOnStart;
        this.destroy();
        return;
      }
    }
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
    loadDirByName('config', JsonAsset, (err: Error | null, assets: Record<string, JsonAsset>) => {
      if (err) {
        console.error('[Boot] 加载配置表失败', err);
        return;
      }
      const f: Record<string, unknown> = {};
      for (const name in assets) f[name] = assets[name].json;
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
    core.claimChest(1);
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
    core.equipBest();
    core.upgradeTeam();
    while (core.challengeStage().win);
    if (core.towerUnlocked()) while (core.challengeFloor().win);
    App.save();
  }
}

function describeReward(r: RevealReward): string {
  const parts = ['收服！'];
  if (r.dianjing) parts.push('点睛成功：变为闪光！');
  if (r.shards > 0) parts.push(`星魄 +${r.shards}`);
  if (r.gold > 0) parts.push(`金币 +${formatNumber(r.gold)}　经验 +${formatNumber(r.exp)}`);
  if (r.seals < 2) parts.push('（2 印得金币经验，3 印得星魄并有机会点睛）');
  return parts.join('\n');
}

if (!EDITOR) {
  director.on(Director.EVENT_AFTER_SCENE_LAUNCH, autoBoot);
  // 万一脚本加载时场景已经开始运行，补检查一次
  if (director.getScene()) setTimeout(autoBoot, 0);
}
