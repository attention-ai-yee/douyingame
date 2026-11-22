import { _decorator, Component, Graphics, Label, Node, UIOpacity } from 'cc';
import { App } from '../../app/App';
import { PullResult } from '../../core';
import { makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite } from '../ui/Skin';
import { hex, makeFullScreen, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';
import { skinButton } from '../ui/Widgets';

const { ccclass } = _decorator;
const OL = '#4a2f27';
/** 雾色：白（凡）、蓝（灵）、紫（稀）、金（传说）。 */
const FOG: Record<string, string> = { fan: '#f4f1ea', ling: '#7cc4ff', xi: '#c39bff', chuanshuo: '#ffd84d' };
const CARD_W = 124;
const CARD_H = 168;

interface Card {
  r: PullResult;
  node: Node;
  back: Node;
  front: Node;
  flipped: boolean;
  /** 翻牌动画进度 0..1，-1 表示没在翻。 */
  anim: number;
}

export interface PullRevealHooks {
  /** 结束（玩家点了确定），again 为 true 表示要再来一次十连。 */
  onClose(again: boolean): void;
}

/**
 * 十连揭晓（游戏设计文档 5.2）：
 * 先按稀有度出现雾色卡背（白/蓝/紫/金，闪光带星光），再逐张翻开；点屏幕加快，「跳过」一次翻完。
 * 翻到稀有及以上：暂停，放行一只现身拍符（Boot 负责弹出），拍完继续翻。
 * 最后显示汇总和「再来十连」。
 */
@ccclass('PullRevealView')
export class PullRevealView extends Component {
  static open(parent: Node, mountainId: string, results: PullResult[], revealIds: number[], hooks: PullRevealHooks): PullRevealView {
    const n = uiNode('PullReveal', parent);
    const v = n.addComponent(PullRevealView);
    v.setup(mountainId, results, revealIds, hooks);
    return v;
  }

  /** 为 true 时 Boot 不要弹现身拍符（还没翻到稀有那张）。 */
  holding = true;

  private hooks!: PullRevealHooks;
  private mountainId = '';
  private cards: Card[] = [];
  /** 这次十连产生的拍符（按顺序对应稀有卡）。 */
  private revealIds: number[] = [];
  private revealIndex = 0;
  private waitingId = -1;
  private next = 0;
  private timer = 0.7;
  private fast = false;
  private done = false;
  private t = 0;
  private hint!: Label;
  private skipBtn!: Node;
  private summary: Node | null = null;

  private setup(mountainId: string, results: PullResult[], revealIds: number[], hooks: PullRevealHooks): void {
    this.mountainId = mountainId;
    this.hooks = hooks;
    this.revealIds = revealIds.slice();
    const vs = visibleSize();
    const mask = makeFullScreen(this.node, 'Mask', '#1d1612', 250);
    mask.on(Node.EventType.TOUCH_END, () => {
      this.fast = true;
      this.timer = Math.min(this.timer, 0.05);
    });
    makeLabel(this.node, results.length >= 10 ? '寻兽十连' : '寻兽', 44, '#fff4d6', 0, vs.height / 2 - 140);
    this.hint = makeLabel(this.node, '山雾里有东西在动……', 26, '#d9cbb5', 0, vs.height / 2 - 200);
    const cols = Math.min(5, results.length);
    results.forEach((r, i) => {
      const row = Math.floor(i / 5);
      const rows = Math.ceil(results.length / 5);
      const x = ((i % 5) - (cols - 1) / 2) * (CARD_W + 14);
      const y = 60 + ((rows - 1) / 2 - row) * (CARD_H + 26);
      this.cards.push(this.makeCard(r, x, y));
    });
    const skip = makeSprite(this.node, 'pill', 150, 56, vs.width / 2 - 100, vs.height / 2 - 60, { fallback: '#fffaf0', alpha: 230 });
    makeLabel(skip, '跳过', 26, OL);
    skip.on(Node.EventType.TOUCH_END, () => this.skipAll());
    this.skipBtn = skip;
  }

  private makeCard(r: PullResult, x: number, y: number): Card {
    const node = uiNode('Card', this.node, x, y);
    // 卡背：雾色 + 中间一团光
    const back = uiNode('Back', node);
    const g = back.addComponent(Graphics);
    const fog = FOG[r.rarity] || FOG.fan;
    g.fillColor = hex(fog, 255);
    g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    g.fill();
    g.fillColor = hex('#ffffff', 120);
    g.circle(0, 6, 36);
    g.fill();
    g.lineWidth = 5;
    g.strokeColor = hex(OL);
    g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    g.stroke();
    makeLabel(back, '？', 48, OL, 0, 4);
    if (r.shiny) makeLabel(back, '✦  ✦', 26, '#ffffff', 0, CARD_H / 2 - 24);
    // 正面：立绘 + 名字 + 品质色边
    const front = uiNode('Front', node);
    const fg = front.addComponent(Graphics);
    const rar = App.cfg.beasts.rarities[r.rarity];
    fg.fillColor = hex('#fffaf0');
    fg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    fg.fill();
    fg.lineWidth = 6;
    fg.strokeColor = hex(r.rarity === 'fan' ? '#c9b8a2' : rar.color);
    fg.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    fg.stroke();
    makeBeastIcon(front, r.beastId, 100, 0, 18, { frame: null });
    makeLabel(front, App.core.idx.beast[r.beastId].name, 22, OL, 0, -52);
    makeLabel(front, rar.name, 18, r.rarity === 'fan' ? '#8a6d55' : rar.color, 0, -72);
    if (r.isNew) {
      const stamp = makeSprite(front, 'btn_red', 52, 30, CARD_W / 2 - 22, CARD_H / 2 - 16, { fallback: '#ff5a5a' });
      makeLabel(stamp, '新', 18, '#ffffff', 0, 2);
    }
    if (r.shiny) makeLabel(front, '✦闪光', 18, '#e8a317', -CARD_W / 2 + 34, CARD_H / 2 - 16);
    front.active = false;
    // 出场：先透明，按顺序浮现
    const op = node.addComponent(UIOpacity);
    op.opacity = 0;
    return { r, node, back, front, flipped: false, anim: -1 };
  }

  update(dt: number): void {
    this.t += dt;
    // 卡背依次浮现（0.5 秒内）
    this.cards.forEach((c, i) => {
      const op = c.node.getComponent(UIOpacity);
      if (op && op.opacity < 255) op.opacity = Math.min(255, Math.round(255 * Math.max(0, (this.t - i * 0.04) / 0.25)));
    });
    // 翻牌动画：横向缩到 0，换面，再展开
    for (const c of this.cards) {
      if (c.anim < 0) continue;
      c.anim = Math.min(1, c.anim + dt / (this.fast ? 0.12 : 0.26));
      const big = c.r.needsReveal ? 1.15 : 1;
      if (c.anim < 0.5) c.node.setScale(1 - c.anim * 2, 1, 1);
      else {
        if (!c.flipped) {
          c.flipped = true;
          c.back.active = false;
          c.front.active = true;
        }
        const k = (c.anim - 0.5) * 2;
        c.node.setScale(k * big, big + (1 - k) * 0.1, 1);
      }
      if (c.anim >= 1) c.anim = -1;
    }
    if (this.done) return;
    // 等拍符结束
    if (this.waitingId >= 0) {
      if (App.core.revealQueue.some((p) => p.id === this.waitingId)) return;
      this.waitingId = -1;
      this.holding = true;
      setLabel(this.hint, '');
      this.timer = 0.3;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.next >= this.cards.length) {
      this.finish();
      return;
    }
    const c = this.cards[this.next++];
    c.anim = 0;
    if (c.r.needsReveal) {
      // 稀有及以上：翻开后放行一只现身拍符
      setLabel(this.hint, c.r.rarity === 'chuanshuo' ? '金光冲天！传说异兽现身！' : '紫气升腾！稀有异兽现身！', c.r.rarity === 'chuanshuo' ? '#ffd84d' : '#c39bff');
      const id = this.revealIds[this.revealIndex++];
      this.scheduleOnce(() => {
        if (id !== undefined && App.core.revealQueue.some((p) => p.id === id)) {
          this.waitingId = id;
          this.holding = false;
        }
      }, 0.6);
      this.timer = 0.7;
    } else {
      this.timer = this.fast ? 0.08 : 0.3;
    }
  }

  /** 跳过：剩下的稀有按 1 印结算（游戏设计文档 5.2），全部翻开。 */
  private skipAll(): void {
    if (this.done) return;
    const core = App.core;
    for (let k = this.revealIndex; k < this.revealIds.length; k++) {
      const p = core.revealQueue.filter((x) => x.id === this.revealIds[k])[0];
      if (p) core.finishReveal(p, App.cfg.reveal.skipSeals);
    }
    this.revealIndex = this.revealIds.length;
    this.waitingId = -1;
    this.holding = true;
    for (let i = this.next; i < this.cards.length; i++) this.cards[i].anim = 0;
    this.fast = true;
    this.next = this.cards.length;
    this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.holding = false;
    this.skipBtn.active = false;
    setLabel(this.hint, '');
    App.save();
    const vs = visibleSize();
    const p = uiNode('Summary', this.node, 0, -vs.height / 2 + 250);
    this.summary = p;
    const res = this.cards.map((c) => c.r);
    const news = res.filter((r) => r.isNew).length;
    const shards = res.filter((r) => !r.isNew).reduce((a, r) => a + r.shardsGained, 0);
    const pity = App.cfg.pools.pity;
    const s = App.core.state;
    const lines = [`新异兽 ${news} 只 · 星魄 +${shards}`, `距稀有保底 ${Math.max(0, pity.xi - s.pity.sinceXi)} 次 · 距传说保底 ${Math.max(0, pity.chuanshuo - s.pity.sinceChuanshuo)} 次`];
    const l = makeLabel(p, lines.join('\n'), 26, '#fff4d6', 0, 110);
    l.lineHeight = 40;
    const tenOk = res.length >= 10 && (App.core.canFreeTenPull() || s.tickets >= 10);
    if (tenOk) {
      skinButton(p, 'btn_ink', '确定', 230, 96, () => this.close(false), -140, 0);
      skinButton(p, 'btn_red', '再来十连', 260, 96, () => this.close(true), 140, 0, App.core.canFreeTenPull() ? '今日免费' : '寻兽符 ×10');
    } else {
      skinButton(p, 'btn_red', '确定', 260, 96, () => this.close(false), 0, 0);
    }
  }

  private close(again: boolean): void {
    this.node.destroy();
    this.hooks.onClose(again);
  }

  get mountain(): string {
    return this.mountainId;
  }
}
