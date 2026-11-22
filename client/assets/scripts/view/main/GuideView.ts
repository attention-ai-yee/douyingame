import { _decorator, Component, Graphics, Label, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { TutorialStep } from '../../core';
import { makeSprite } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';

const { ccclass } = _decorator;
const OL = '#4a2f27';

/**
 * 新手引导的指引层：在目标按钮上画一个跳动的圈 + 箭头 + 气泡文字。
 * 不拦截点击（玩家可以随便点），右下角可以"跳过引导"。
 *
 * 界面代码用 registerGuideTarget(key, node, tab) 登记按钮；这里按"当前步骤 → 候选目标"
 * 挑第一个看得见的来指（例如"闯关"这一步：在关卡地图就指挑战按钮，在地图列表就指南山，否则指进山页签）。
 */

interface Target {
  node: Node;
  /** 只在某个页签显示时才有效（例如宝箱只在挂机页）。 */
  tab?: string;
}

const targets: Record<string, Target> = {};

export function registerGuideTarget(key: string, node: Node, tab?: string): void {
  targets[key] = { node, tab };
}

const STEP_TARGETS: Record<TutorialStep, [string, string][]> = {
  signin: [
    ['signin_claim', '师父留下了一只灵兽\n点这里领取！'],
    ['signin_btn', '先领取签到奖励'],
  ],
  chest: [
    ['chest_claim', '点「领取」把战利品收下'],
    ['chest', '异兽们一直在挂机打怪\n战利品都攒在宝箱里，点开看看'],
    ['tab_battle', '回到挂机页领取宝箱'],
  ],
  upgrade: [
    ['beasts_upgrade', '金币和经验够了\n点「一键升级」让异兽变强'],
    ['tab_beasts', '去「异兽」页给异兽升级'],
  ],
  stage: [
    ['stage_challenge', '挑战第 1 关！'],
    ['tab_mountain', '变强了！去「进山」闯关'],
  ],
  summon: [
    ['pull10_nanshan', '每天第一次十连免费！'],
    ['seg_summon', '点「寻兽」'],
    ['tab_beasts', '去「异兽」页寻找新的异兽'],
  ],
};

export interface GuideHost {
  /** 指引层所在的根节点（MainView），目标坐标换算到这里。 */
  root: Node;
  /** 弹窗、闯关界面所在的层；有弹窗时只指弹窗里的按钮。 */
  overlay: Node;
  isModalOpen(): boolean;
  currentTab(): string;
  onFinished(): void;
}

@ccclass('GuideView')
export class GuideView extends Component {
  static create(parent: Node, host: GuideHost): GuideView {
    const n = uiNode('Guide', parent);
    const v = n.addComponent(GuideView);
    v.setup(host);
    return v;
  }

  private host!: GuideHost;
  private ring!: Graphics;
  private arrow!: Graphics;
  private bubble!: Node;
  private text!: Label;
  private skip!: Node;
  private t = 0;
  private lastStep: TutorialStep | null | undefined = undefined;
  private skipped = false;

  private setup(host: GuideHost): void {
    this.host = host;
    this.ring = uiNode('Ring', this.node).addComponent(Graphics);
    this.arrow = uiNode('Arrow', this.node).addComponent(Graphics);
    this.bubble = makeSprite(this.node, 'panel_paper', 420, 120, 0, 0, { fallback: '#fff8ea' });
    this.text = makeLabel(this.bubble, '', 26, OL);
    this.text.lineHeight = 36;
    this.skip = makeSprite(this.node, 'pill', 150, 48, 0, 0, { fallback: '#fffaf0', alpha: 220 });
    makeLabel(this.skip, '跳过引导', 22, '#8a6d55');
    this.skip.on(Node.EventType.TOUCH_END, () => {
      this.skipped = true;
      App.core.skipTutorial();
      App.analytics.track('tutorial_step', { step: 'skip' });
      App.save();
    });
    this.show(false);
  }

  private show(on: boolean): void {
    this.ring.node.active = on;
    this.arrow.node.active = on;
    this.bubble.active = on;
  }

  update(dt: number): void {
    if (!App.ready) return;
    this.t += dt;
    const step = App.core.tutorialStep();
    if (step !== this.lastStep) {
      if (this.lastStep !== undefined) App.analytics.track('tutorial_step', { step: step || 'done' });
      if (this.lastStep && !step && !this.skipped) this.host.onFinished();
      this.lastStep = step;
    }
    this.skip.active = !!step && !App.core.revealQueue.length && !this.host.isModalOpen();
    const vs = visibleSize();
    const H = vs.height;
    const W = vs.width;
    this.skip.setPosition(W / 2 - 100, -H / 2 + 200);
    if (!step) {
      this.show(false);
      return;
    }
    const pick = this.pickTarget(step);
    if (!pick) {
      this.show(false);
      return;
    }
    this.show(true);
    const { x, y, w, h, text } = pick;
    // 圈：跟着目标大小，呼吸式放大缩小
    const k = 1 + 0.08 * Math.sin(this.t * 6);
    const rw = (w / 2 + 14) * k;
    const rh = (h / 2 + 14) * k;
    const g = this.ring;
    g.clear();
    g.lineWidth = 6;
    g.strokeColor = hex('#ff5a5a', 230);
    g.roundRect(x - rw, y - rh, rw * 2, rh * 2, Math.min(rw, rh, 40));
    g.stroke();
    // 箭头和气泡：目标在屏幕上半部分时放在下面，否则放在上面
    const below = y > H / 2 - 420;
    const dir = below ? -1 : 1;
    const bob = 10 * Math.sin(this.t * 5);
    const ay = y + dir * (rh + 34 + bob);
    const a = this.arrow;
    a.clear();
    a.fillColor = hex('#ff5a5a');
    a.moveTo(x, ay - dir * 18);
    a.lineTo(x - 22, ay + dir * 14);
    a.lineTo(x + 22, ay + dir * 14);
    a.close();
    a.fill();
    a.lineWidth = 3;
    a.strokeColor = hex('#ffffff');
    a.stroke();
    setLabel(this.text, text);
    const lines = text.split('\n').length;
    const bh = 50 + lines * 36;
    const bw = 420;
    const bx = Math.max(-W / 2 + bw / 2 + 12, Math.min(W / 2 - bw / 2 - 12, x));
    const by = ay + dir * (bh / 2 + 22);
    this.bubble.setPosition(bx, by);
    const but = this.bubble.getComponent(UITransform);
    if (but) but.setContentSize(bw, bh);
  }

  /** 按候选顺序找第一个看得见的目标，返回它在 root 里的位置和大小。 */
  private pickTarget(step: TutorialStep): { x: number; y: number; w: number; h: number; text: string } | null {
    const modal = this.host.isModalOpen();
    for (const [key, text] of STEP_TARGETS[step]) {
      const t = targets[key];
      if (!t) continue;
      if (t.tab && t.tab !== this.host.currentTab()) continue;
      const p = this.locate(t.node, modal);
      if (!p) continue;
      const ut = t.node.getComponent(UITransform);
      return { x: p.x, y: p.y, w: ut ? ut.width : 100, h: ut ? ut.height : 100, text };
    }
    return null;
  }

  /** 节点在 root 里的坐标；节点已销毁、被隐藏，或者有弹窗时不在弹窗里，返回 null。 */
  private locate(node: Node, modal: boolean): { x: number; y: number } | null {
    if ((node as unknown as { isValid?: boolean }).isValid === false) return null;
    let x = 0;
    let y = 0;
    let n: Node | null = node;
    let inOverlay = false;
    while (n && n !== this.host.root) {
      if (!n.active) return null;
      if (n === this.host.overlay) inOverlay = true;
      x += n.position.x;
      y += n.position.y;
      n = n.parent;
    }
    if (n !== this.host.root) return null; // 已经从界面上拿掉了
    if (modal !== inOverlay) return null;
    return { x, y };
  }
}
