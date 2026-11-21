import { Graphics, Label, Node, UITransform } from 'cc';
import { App, RELEASE } from '../../app/App';
import { formatNumber, PullResult, RARITIES } from '../../core';
import { makeBeastIcon, starText } from '../ui/BeastIcon';
import { makeSprite } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { alignedLabel, skinButton, SkinButton } from '../ui/Widgets';

const OL = '#4a2f27';

export interface MainHooks {
  openPractice(): void;
  getAutoPlay(): boolean;
  setAutoPlay(on: boolean): void;
}

export interface PageHost {
  hooks: MainHooks;
  toast(text: string): void;
  doPull(mountainId: string, count: number): void;
  showRates(): void;
  resetSave(): void;
}

export interface Page {
  node: Node;
  refresh(): void;
}

/** 页面底板：宣纸面板 + 标题，吃掉点击（避免点到下面的战斗区）。 */
function pageFrame(parent: Node, w: number, h: number, y: number, title: string): { root: Node; title: Label } {
  const root = makeSprite(parent, 'panel_paper', w, h, 0, y, { fallback: '#fff8ea' });
  root.on(Node.EventType.TOUCH_START, () => undefined);
  const t = makeLabel(root, title, 36, OL, 0, h / 2 - 50);
  return { root, title: t };
}

/** 简单的圆角卡片背景。 */
function card(parent: Node, w: number, h: number, x: number, y: number, fill = '#ffffff', stroke = OL): Node {
  const n = uiNode('Card', parent, x, y);
  const g = n.addComponent(Graphics);
  g.fillColor = hex(fill);
  g.roundRect(-w / 2, -h / 2, w, h, 22);
  g.fill();
  g.lineWidth = 4;
  g.strokeColor = hex(stroke);
  g.roundRect(-w / 2, -h / 2, w, h, 22);
  g.stroke();
  const ut = n.getComponent(UITransform) || n.addComponent(UITransform);
  ut.setContentSize(w, h);
  return n;
}

// ------------------------------------------------------------ 异兽

export class BeastsPage implements Page {
  node: Node;
  private grid: Node;
  private sig = '';
  private title: Label;

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '我的异兽');
    this.node = f.root;
    this.title = f.title;
    this.grid = uiNode('Grid', this.node);
  }

  refresh(): void {
    const s = App.core.state;
    const sig = Object.keys(s.beasts)
      .map((id) => `${id}:${s.beasts[id].star}:${s.beasts[id].shards}`)
      .join('|') + JSON.stringify(s.wildShards) + s.team.join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.rebuild();
  }

  private rebuild(): void {
    const core = App.core;
    this.grid.destroy();
    this.grid = uiNode('Grid', this.node);
    const ids = Object.keys(core.state.beasts).sort(
      (a, b) =>
        core.f.unitPower(b, core.state.beasts[b].star, core.state.beasts[b].awaken, core.state.beasts[b].shiny) -
        core.f.unitPower(a, core.state.beasts[a].star, core.state.beasts[a].awaken, core.state.beasts[a].shiny),
    );
    setLabel(this.title, `我的异兽（${ids.length}/${App.cfg.beasts.beasts.length}）`);
    const cols = 5;
    const cw = (this.w - 40) / cols;
    const ch = 225;
    const top = this.h / 2 - 120;
    ids.forEach((id, i) => {
      const x = -this.w / 2 + 20 + cw * (i % cols) + cw / 2;
      const y = top - Math.floor(i / cols) * ch - 50;
      const b = core.state.beasts[id];
      const def = core.idx.beast[id];
      const onTeam = core.state.team.indexOf(id) >= 0;
      makeBeastIcon(this.grid, id, 96, x, y, {});
      if (onTeam) {
        const tag = makeSprite(this.grid, 'btn_red', 60, 30, x + 36, y + 46, { fallback: '#ff5a5a' });
        makeLabel(tag, '上阵', 16, '#ffffff', 0, 2);
      }
      makeLabel(this.grid, def.name, 24, OL, x, y - 66);
      makeLabel(this.grid, starText(b.star), 20, '#e8a317', x, y - 94);
      const cost = core.starUpCost(id);
      if (cost === null) {
        makeLabel(this.grid, '已满星', 18, '#8a6d55', x, y - 122);
      } else if (core.canStarUp(id, true)) {
        skinButton(this.grid, 'btn_jade', '升星', 108, 46, () => {
          if (core.starUp(id, true)) {
            this.host.toast(`${def.name} 升到 ${core.state.beasts[id].star} 星！`);
            App.analytics.track('star_up', { beast: id, star: core.state.beasts[id].star });
            App.save();
          }
        }, x, y - 126);
      } else {
        makeLabel(this.grid, `星魄 ${b.shards}/${cost}`, 18, '#8a6d55', x, y - 122);
      }
    });
    if (!ids.length) makeLabel(this.grid, '还没有异兽，去「进山」看看吧', 28, OL);
  }
}

// ------------------------------------------------------------ 进山

export class MountainPage implements Page {
  node: Node;
  private ticketsL: Label;
  private pityL: Label;
  private adBtn: SkinButton;
  private cards: Node;
  private sig = '';

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '进山寻兽');
    this.node = f.root;
    const hy = h / 2 - 110;
    makeSprite(this.node, 'icon_ticket', 56, 56, -w / 2 + 60, hy, {});
    this.ticketsL = alignedLabel(this.node, '', 28, OL, -w / 2 + 92, hy, 'left');
    this.adBtn = skinButton(this.node, 'btn_gold', '看视频 +5 符', 250, 76, () => this.onAdTickets(), w / 2 - 150, hy, '');
    this.pityL = makeLabel(this.node, '', 22, '#8a6d55', 0, hy - 62);
    this.cards = uiNode('Cards', this.node);
    skinButton(this.node, 'btn_ink', '概率说明', 220, 72, () => this.host.showRates(), 0, -h / 2 + 60);
  }

  refresh(): void {
    const core = App.core;
    const s = core.state;
    setLabel(this.ticketsL, `进山符 ${s.tickets}`);
    const p = App.cfg.pools.pity;
    setLabel(this.pityL, `距稀有保底 ${Math.max(0, p.xi - s.pity.sinceXi)} 次 · 距传说保底 ${Math.max(0, p.chuanshuo - s.pity.sinceChuanshuo)} 次`);
    const left = App.ads.remaining('tickets');
    this.adBtn.setText('看视频 +5 符', left === null ? '' : `今日剩 ${left} 次`);
    this.adBtn.setEnabled(App.ads.available('tickets'));
    const sig = `${s.stage}|${s.tickets}|${core.canFreeTenPull()}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.buildCards();
  }

  private buildCards(): void {
    const core = App.core;
    this.cards.destroy();
    this.cards = uiNode('Cards', this.node);
    const cw = this.w - 60;
    const chh = 210;
    const start = this.h / 2 - 290;
    core.mountains().forEach((m, i) => {
      const y = start - i * (chh + 18);
      const c = card(this.cards, cw, chh, 0, y, m.unlocked ? '#ffffff' : '#ece4d8');
      alignedLabel(c, m.name, 36, OL, -cw / 2 + 30, chh / 2 - 44, 'left');
      const def = App.cfg.pools.mountains[i];
      // 可能遇到的稀有异兽
      const rare = def.tiers.chuanshuo.concat(def.tiers.xi).map((x) => x[0]).filter((v, k, a) => a.indexOf(v) === k).slice(0, 3);
      rare.forEach((id, k) => makeBeastIcon(c, id, 64, cw / 2 - 60 - k * 74, chh / 2 - 52, { silhouette: !core.state.beasts[id] }));
      if (!m.unlocked) {
        const need = (m.chapter - 1) * App.cfg.stages.chapterLength;
        makeLabel(c, `通关第 ${need} 关后开放`, 28, '#8a6d55', 0, -20);
        return;
      }
      const depthName = App.cfg.pools.depths[m.depth as 'shallow'].name;
      const rates = App.cfg.pools.depths[m.depth as 'shallow'].rates;
      alignedLabel(c, `${depthName} · 稀有 ${Math.round(rates.xi * 100)}% · 传说 ${Math.round(rates.chuanshuo * 100)}%`, 22, '#8a6d55', -cw / 2 + 30, chh / 2 - 92, 'left');
      const free = core.canFreeTenPull();
      skinButton(c, 'btn_ink', '单抽', 230, 90, () => this.host.doPull(m.id, 1), -cw / 4 + 10, -chh / 2 + 62, '进山符 ×1');
      skinButton(c, 'btn_red', '十连', 260, 90, () => this.host.doPull(m.id, 10), cw / 4 - 10, -chh / 2 + 62, free ? '今日免费' : '进山符 ×10');
    });
  }

  private async onAdTickets(): Promise<void> {
    const n = App.cfg.ads.rewarded.tickets.tickets || 5;
    const r = await App.ads.showRewarded('tickets');
    if (!r.granted) {
      this.host.toast(r.status === 'skipped' ? '没有看完视频，没有奖励' : '暂时没有广告，稍后再试');
      return;
    }
    const got = Math.max(1, Math.floor(n * r.ratio));
    App.core.grantTickets(got);
    App.save();
    this.host.toast(`获得进山符 ×${got}`);
  }
}

// ------------------------------------------------------------ 图鉴

export class BookPage implements Page {
  node: Node;
  private grid: Node;
  private title: Label;
  private sig = '';

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '山海图鉴');
    this.node = f.root;
    this.title = f.title;
    this.grid = uiNode('Grid', this.node);
  }

  refresh(): void {
    const s = App.core.state;
    const sig = Object.keys(s.beasts).map((id) => id + (s.beasts[id].shiny ? '*' : '')).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.grid.destroy();
    this.grid = uiNode('Grid', this.node);
    const all = App.cfg.beasts.beasts;
    const owned = all.filter((b) => s.beasts[b.id]).length;
    const shiny = all.filter((b) => s.beasts[b.id] && s.beasts[b.id].shiny).length;
    setLabel(this.title, `山海图鉴  收集 ${owned}/${all.length} · 闪光 ${shiny}`);
    const cols = 5;
    const cw = (this.w - 40) / cols;
    const ch = 205;
    const top = this.h / 2 - 130;
    all.forEach((b, i) => {
      const x = -this.w / 2 + 20 + cw * (i % cols) + cw / 2;
      const y = top - Math.floor(i / cols) * ch - 40;
      const have = !!s.beasts[b.id];
      makeBeastIcon(this.grid, b.id, 96, x, y, { silhouette: !have, frame: have ? b.rarity : null });
      makeLabel(this.grid, have ? b.name : '？？？', 24, have ? OL : '#a08a76', x, y - 66);
      makeLabel(this.grid, b.habitat.split('·')[0], 18, '#a08a76', x, y - 92);
      if (have && s.beasts[b.id].shiny) makeLabel(this.grid, '✦闪光', 18, '#e8a317', x + 30, y + 48);
    });
  }
}

// ------------------------------------------------------------ 更多

export class MorePage implements Page {
  node: Node;
  private vibrateBtn: SkinButton;
  private autoBtn: SkinButton;
  private resetBtn: SkinButton;
  private info: Label;
  private resetArmed = 0;

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '更多');
    this.node = f.root;
    let yy = h / 2 - 130;
    alignedLabel(this.node, '设置', 30, OL, -w / 2 + 40, yy, 'left');
    yy -= 70;
    alignedLabel(this.node, '震动反馈', 26, OL, -w / 2 + 60, yy, 'left');
    this.vibrateBtn = skinButton(this.node, 'btn_jade', '开', 150, 64, () => {
      App.core.state.settings.vibrate = !App.core.state.settings.vibrate;
      App.save();
    }, w / 2 - 120, yy);
    yy -= 100;
    alignedLabel(this.node, '开发者工具（上线前隐藏）', 30, OL, -w / 2 + 40, yy, 'left');
    yy -= 80;
    skinButton(this.node, 'btn_ink', '拍符练习', 280, 80, () => this.host.hooks.openPractice(), -w / 4 + 10, yy);
    this.autoBtn = skinButton(this.node, 'btn_ink', '自动模式：关', 280, 80, () => this.host.hooks.setAutoPlay(!this.host.hooks.getAutoPlay()), w / 4 - 10, yy);
    yy -= 100;
    this.resetBtn = skinButton(this.node, 'btn_red', '清档重开', 280, 80, () => this.onReset(), -w / 4 + 10, yy);
    yy -= 90;
    this.info = makeLabel(this.node, '', 22, '#6b5444', 0, yy - 150);
    this.info.lineHeight = 34;
  }

  refresh(): void {
    const core = App.core;
    const s = core.state;
    this.vibrateBtn.setText(s.settings.vibrate ? '开' : '关');
    this.autoBtn.setText(`自动模式：${this.host.hooks.getAutoPlay() ? '开' : '关'}`);
    if (this.resetArmed && Date.now() - this.resetArmed > 3000) {
      this.resetArmed = 0;
      this.resetBtn.setText('清档重开');
    }
    const lines = [
      `版本 ${RELEASE} · 平台 ${App.platform.name}`,
      `关卡 ${s.stage} · 镇妖塔 ${s.floor} 层 · 战力 ${formatNumber(core.teamPower())}`,
      `挂机 ${formatNumber(core.goldPerMin())}/分 · 阵位 ${s.slotLevels.slice(0, core.slotsAvailable()).join('/')}`,
      `星魄（万能）${RARITIES.map((r) => s.wildShards[r]).join('/')} · 保底 ${s.pity.sinceXi}/${s.pity.sinceChuanshuo}`,
      `今日：免费十连 ${s.daily.freeTenPullsUsed} · 野遇 ${s.daily.wildEncounters} · 助战 ${s.daily.assistsUsed}`,
    ];
    setLabel(this.info, lines.join('\n'));
  }

  private onReset(): void {
    if (!this.resetArmed) {
      this.resetArmed = Date.now();
      this.resetBtn.setText('再点一次确认');
      return;
    }
    this.host.resetSave();
  }
}

export function describePull(results: PullResult[]): string {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.beastId] = (counts[r.beastId] || 0) + 1;
  return Object.keys(counts)
    .map((id) => `${App.core.idx.beast[id].name}${counts[id] > 1 ? '×' + counts[id] : ''}`)
    .join('、');
}
