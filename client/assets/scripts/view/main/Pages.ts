import { Graphics, Label, Node, UITransform } from 'cc';
import { App, RELEASE } from '../../app/App';
import { formatNumber, RARITIES } from '../../core';
import { makeBeastIcon, starText } from '../ui/BeastIcon';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { alignedLabel, redDot, skinButton, SkinButton } from '../ui/Widgets';
import { PRIVACY_POLICY, USER_AGREEMENT } from '../more/LegalText';
import { registerGuideTarget } from './GuideView';

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
  openBeast(id: string): void;
  openBag(): void;
  openStage(kind: 'stage' | 'tower'): void;
  openText(title: string, text: string): void;
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

/** 页面顶部的分页切换（例如"我的异兽 / 寻兽"）：选中的用红色按钮，其余用灰色。 */
function segmented(parent: Node, names: string[], w: number, y: number, onPick: (i: number) => void): { set(i: number): void; nodes: Node[] } {
  const bw = Math.min(300, (w - 60) / names.length);
  const nodes = names.map((name, i) => {
    const n = makeSprite(parent, 'btn_ink', bw - 12, 76, (i - (names.length - 1) / 2) * bw, y, { fallback: '#2a2e36' });
    makeLabel(n, name, 30, '#ffffff', 0, 4);
    n.on(Node.EventType.TOUCH_END, () => onPick(i));
    return n;
  });
  return {
    nodes,
    set(i: number) {
      nodes.forEach((n, k) => {
        setSprite(n, k === i ? 'btn_red' : 'btn_ink', bw - 12, 76, { fallback: k === i ? '#b3261e' : '#2a2e36', color: k === i ? undefined : '#c8c0b6' });
      });
    },
  };
}

// ------------------------------------------------------------ 异兽（我的异兽 / 寻兽）

export class BeastsPage implements Page {
  node: Node;
  private tab = 0;
  private seg: { set(i: number): void; nodes: Node[] };
  private mine: Node;
  private summon: Node;
  private grid: Node;
  private sig = '';
  private bagBtn: SkinButton;
  private bagDot: Node;
  // 寻兽
  private ticketsL: Label;
  private pityL: Label;
  private adBtn: SkinButton;
  private cards: Node;
  private summonSig = '';

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '');
    this.node = f.root;
    this.seg = segmented(this.node, ['我的异兽', '寻兽'], w, h / 2 - 56, (i) => this.show(i));
    registerGuideTarget('seg_summon', this.seg.nodes[1], 'beasts');
    // 我的异兽
    this.mine = uiNode('Mine', this.node);
    const hy = h / 2 - 140;
    this.bagBtn = skinButton(this.mine, 'btn_gold', '装备背包', 230, 72, () => this.host.openBag(), -w / 2 + 145, hy);
    this.bagDot = redDot(this.bagBtn.node, 100, 28);
    skinButton(this.mine, 'btn_ink', '上阵最强', 230, 72, () => {
      App.core.autoTeam();
      App.save();
      this.host.toast('已上阵战力最高的异兽');
    }, w / 2 - 145, hy);
    makeLabel(this.mine, '点异兽可以升级、升星、换装备', 20, '#a08a76', 0, hy - 56);
    this.grid = uiNode('Grid', this.mine);
    // 寻兽
    this.summon = uiNode('Summon', this.node);
    const sy = h / 2 - 140;
    makeSprite(this.summon, 'icon_ticket', 56, 56, -w / 2 + 60, sy, {});
    this.ticketsL = alignedLabel(this.summon, '', 28, OL, -w / 2 + 92, sy, 'left');
    this.adBtn = skinButton(this.summon, 'btn_gold', '看视频 +5 符', 250, 76, () => this.onAdTickets(), w / 2 - 150, sy, '');
    this.pityL = makeLabel(this.summon, '', 22, '#8a6d55', 0, sy - 62);
    this.cards = uiNode('Cards', this.summon);
    skinButton(this.summon, 'btn_ink', '概率说明', 220, 72, () => this.host.showRates(), 0, -h / 2 + 60);
    this.show(0);
  }

  show(i: number): void {
    this.tab = i;
    this.seg.set(i);
    this.mine.active = i === 0;
    this.summon.active = i === 1;
    this.sig = '';
    this.summonSig = '';
    this.refresh();
  }

  refresh(): void {
    if (this.tab === 0) this.refreshMine();
    else this.refreshSummon();
  }

  // ---------------- 我的异兽

  private refreshMine(): void {
    const core = App.core;
    const s = core.state;
    this.bagBtn.setText(`装备背包 ${s.bag.length}`);
    this.bagDot.active = core.hasEquipUpgrade();
    const sig = Object.keys(s.beasts)
      .map((id) => `${id}:${s.beasts[id].star}:${s.beasts[id].shards}:${s.beasts[id].level}`)
      .join('|') + JSON.stringify(s.wildShards) + s.team.join(',') + Math.floor(s.gold) + Math.floor(s.exp);
    if (sig === this.sig) return;
    this.sig = sig;
    this.grid.destroy();
    this.grid = uiNode('Grid', this.mine);
    const ids = Object.keys(s.beasts).sort((a, b) => core.unitPower(b) - core.unitPower(a));
    const cols = 5;
    const cw = (this.w - 40) / cols;
    const ch = 196;
    const top = this.h / 2 - 250;
    ids.forEach((id, i) => {
      const x = -this.w / 2 + 20 + cw * (i % cols) + cw / 2;
      const y = top - Math.floor(i / cols) * ch;
      const b = s.beasts[id];
      const def = core.idx.beast[id];
      const icon = makeBeastIcon(this.grid, id, 96, x, y, {});
      const ut = icon.node.addComponent(UITransform);
      ut.setContentSize(cw - 4, ch - 10);
      icon.node.on(Node.EventType.TOUCH_END, () => this.host.openBeast(id));
      if (s.team.indexOf(id) >= 0) {
        const tag = makeSprite(this.grid, 'btn_red', 60, 30, x + 36, y + 46, { fallback: '#ff5a5a' });
        makeLabel(tag, '上阵', 16, '#ffffff', 0, 2);
      }
      if (core.canStarUp(id, true) || core.canLevelUp(id)) redDot(this.grid, x - 40, y + 44);
      makeLabel(this.grid, `${def.name} Lv.${b.level}`, 22, OL, x, y - 64);
      makeLabel(this.grid, starText(b.star), 18, '#e8a317', x, y - 90);
    });
  }

  // ---------------- 寻兽

  private refreshSummon(): void {
    const core = App.core;
    const s = core.state;
    setLabel(this.ticketsL, `寻兽符 ${s.tickets}`);
    const p = App.cfg.pools.pity;
    setLabel(this.pityL, `距稀有保底 ${Math.max(0, p.xi - s.pity.sinceXi)} 次 · 距传说保底 ${Math.max(0, p.chuanshuo - s.pity.sinceChuanshuo)} 次`);
    const left = App.ads.remaining('tickets');
    this.adBtn.setText('看视频 +5 符', left === null ? '' : `今日剩 ${left} 次`);
    this.adBtn.setEnabled(App.ads.available('tickets'));
    const sig = `${s.stage}|${s.tickets}|${core.canFreeTenPull()}`;
    if (sig === this.summonSig) return;
    this.summonSig = sig;
    this.cards.destroy();
    this.cards = uiNode('Cards', this.summon);
    const cw = this.w - 60;
    const chh = 210;
    const start = this.h / 2 - 330;
    core.mountains().forEach((m, i) => {
      const y = start - i * (chh + 18);
      const c = card(this.cards, cw, chh, 0, y, m.unlocked ? '#ffffff' : '#ece4d8');
      alignedLabel(c, m.name, 36, OL, -cw / 2 + 30, chh / 2 - 44, 'left');
      const def = App.cfg.pools.mountains[i];
      const rare = def.tiers.chuanshuo.concat(def.tiers.xi).map((x) => x[0]).filter((v, k, a) => a.indexOf(v) === k).slice(0, 3);
      rare.forEach((id, k) => makeBeastIcon(c, id, 64, cw / 2 - 60 - k * 74, chh / 2 - 52, { silhouette: !s.beasts[id] }));
      if (!m.unlocked) {
        const prev = App.cfg.stages.chapters[m.chapter - 2];
        makeLabel(c, `在「进山」打通${prev ? prev.name.split('·')[0] : '上一座山'}后开放`, 26, '#8a6d55', 0, -20);
        return;
      }
      const depthName = App.cfg.pools.depths[m.depth as 'shallow'].name;
      const rates = App.cfg.pools.depths[m.depth as 'shallow'].rates;
      alignedLabel(c, `${depthName} · 稀有 ${Math.round(rates.xi * 100)}% · 传说 ${Math.round(rates.chuanshuo * 100)}%`, 22, '#8a6d55', -cw / 2 + 30, chh / 2 - 92, 'left');
      const free = core.canFreeTenPull();
      skinButton(c, 'btn_ink', '寻兽 ×1', 230, 90, () => this.host.doPull(m.id, 1), -cw / 4 + 10, -chh / 2 + 62, '寻兽符 ×1');
      const ten = skinButton(c, 'btn_red', '寻兽 ×10', 260, 90, () => this.host.doPull(m.id, 10), cw / 4 - 10, -chh / 2 + 62, free ? '今日免费' : '寻兽符 ×10');
      registerGuideTarget(`pull10_${m.id}`, ten.node, 'beasts');
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
    this.host.toast(`获得寻兽符 ×${got}`);
  }
}

// ------------------------------------------------------------ 进山（选地图 → 关卡 → 闯关）

export class MountainPage implements Page {
  node: Node;
  private title: Label;
  private body: Node;
  private chapter = 0; // 0 = 地图列表
  private sig = '';

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    const f = pageFrame(parent, w, h, y, '进山闯关');
    this.node = f.root;
    this.title = f.title;
    this.body = uiNode('Body', this.node);
  }

  refresh(): void {
    const core = App.core;
    const sig = `${this.chapter}|${core.state.stage}|${core.state.floor}|${Math.round(core.teamPower())}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.body.destroy();
    this.body = uiNode('Body', this.node);
    if (this.chapter) this.buildStages(this.chapter);
    else this.buildMaps();
  }

  private open(ch: number): void {
    this.chapter = ch;
    this.sig = '';
    this.refresh();
  }

  private buildMaps(): void {
    const core = App.core;
    const len = App.cfg.stages.chapterLength;
    setLabel(this.title, '进山闯关');
    makeLabel(this.body, '选一座山，一关一关打过去。打得越远，挂机收益越高', 22, '#8a6d55', 0, this.h / 2 - 100);
    const cw = this.w - 60;
    const chh = 196;
    const start = this.h / 2 - 230;
    App.cfg.stages.chapters.forEach((ch, i) => {
      const y = start - i * (chh + 16);
      const from = (ch.id - 1) * len;
      const unlocked = core.state.stage >= from;
      const cleared = Math.max(0, Math.min(len, core.state.stage - from));
      const c = card(this.body, cw, chh, 0, y, unlocked ? '#ffffff' : '#ece4d8');
      const bg = `bg_battle_${ch.mountain}`;
      if (Skin.has(bg)) makeSprite(c, bg, cw - 12, chh - 12, 0, 0, { color: unlocked ? '#ffffff' : '#9a9088' });
      const nameBg = makeSprite(c, 'pill', 330, 60, -cw / 2 + 190, chh / 2 - 44, { fallback: '#fffaf0', alpha: 235 });
      makeLabel(nameBg, ch.name, 28, OL);
      const info = makeSprite(c, 'pill', 330, 50, -cw / 2 + 190, -chh / 2 + 40, { fallback: '#fffaf0', alpha: 235 });
      makeLabel(info, unlocked ? `已通关 ${cleared}/${len} · Boss ${ch.boss.name}` : `打通上一座山后开放`, 20, OL);
      if (unlocked) {
        const done = cleared >= len;
        const b = skinButton(c, done ? 'btn_jade' : 'btn_red', done ? '已通关' : '进入', 200, 84, () => this.open(ch.id), cw / 2 - 130, -20);
        registerGuideTarget(`map_enter_${ch.id}`, b.node, 'mountain');
        if (!done && core.canBeatNextStage() && core.f.chapterOfStage(core.state.stage + 1) === ch.id) redDot(b.node, 90, 32);
      }
    });
    // 镇妖塔
    const ty = start - App.cfg.stages.chapters.length * (chh + 16) + 30;
    const t = card(this.body, cw, 130, 0, ty, core.towerUnlocked() ? '#fff1c2' : '#ece4d8');
    alignedLabel(t, '镇妖塔', 32, OL, -cw / 2 + 30, 22, 'left');
    if (core.towerUnlocked()) {
      alignedLabel(t, `已镇压 ${core.state.floor} 层 · 下一层敌方 ${formatNumber(core.nextFloorPower())}`, 20, '#6b5444', -cw / 2 + 30, -26, 'left');
      skinButton(t, 'btn_red', '挑战', 180, 80, () => this.host.openStage('tower'), cw / 2 - 120, 0);
    } else {
      alignedLabel(t, `打通南山经（第 ${App.cfg.stages.tower.unlockStage} 关）后开放`, 20, '#6b5444', -cw / 2 + 30, -26, 'left');
    }
  }

  private buildStages(chId: number): void {
    const core = App.core;
    const len = App.cfg.stages.chapterLength;
    const ch = App.cfg.stages.chapters[chId - 1];
    const from = (chId - 1) * len;
    const cleared = Math.max(0, Math.min(len, core.state.stage - from));
    setLabel(this.title, ch.name);
    skinButton(this.body, 'btn_ink', '‹ 返回', 150, 64, () => this.open(0), -this.w / 2 + 100, this.h / 2 - 50);
    makeLabel(this.body, `已通关 ${cleared}/${len}　·　我方战力 ${formatNumber(core.teamPower())}`, 22, '#8a6d55', 0, this.h / 2 - 108);
    const cols = 5;
    const cw = (this.w - 60) / cols;
    const rowH = 86;
    const top = this.h / 2 - 165;
    for (let k = 1; k <= len; k++) {
      const n = from + k;
      const x = -this.w / 2 + 30 + cw * ((k - 1) % cols) + cw / 2;
      const y = top - Math.floor((k - 1) / cols) * rowH;
      const done = n <= core.state.stage;
      const isNext = n === core.state.stage + 1;
      const boss = core.f.isChapterBoss(n) || core.f.isSmallBoss(n);
      const r = boss ? 40 : 34;
      const node = uiNode('Stage', this.body, x, y);
      const g = node.addComponent(Graphics);
      g.fillColor = hex(done ? '#8fdcae' : isNext ? '#ff7b7b' : '#e5ddd2');
      g.circle(0, 0, r);
      g.fill();
      g.lineWidth = isNext ? 6 : 4;
      g.strokeColor = hex(isNext ? '#b3261e' : done ? '#2f8f68' : '#c9b8a2');
      g.circle(0, 0, r);
      g.stroke();
      makeLabel(node, done ? `✓${k}` : `${k}`, boss ? 28 : 26, done || isNext ? '#ffffff' : '#a08a76', 0, 2);
      if (boss) makeLabel(this.body, core.f.isChapterBoss(n) ? ch.boss.name : '小 Boss', 18, '#b3261e', x, y - r - 10);
      if (isNext) {
        const ut = node.addComponent(UITransform);
        ut.setContentSize(cw, rowH);
        node.on(Node.EventType.TOUCH_END, () => this.host.openStage('stage'));
      }
    }
    const next = core.nextStage();
    if (next && next.chapter === chId) {
      const ok = core.teamPower() >= next.enemyPower;
      const by = -this.h / 2 + 70;
      makeLabel(this.body, `第 ${next.stage - from} 关 敌方战力 ${formatNumber(next.enemyPower)}${ok ? '' : '（还差一点，先去升级）'}`, 22, ok ? '#2f8f68' : '#b3261e', 0, by + 64);
      const go = skinButton(this.body, 'btn_red', `挑战第 ${next.stage - from} 关`, 320, 92, () => this.host.openStage('stage'), 0, by);
      registerGuideTarget('stage_challenge', go.node, 'mountain');
    }
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
    yy -= 90;
    skinButton(this.node, 'btn_ink', '用户协议', 280, 72, () => this.host.openText('用户协议', USER_AGREEMENT), -w / 4 + 10, yy);
    skinButton(this.node, 'btn_ink', '隐私政策', 280, 72, () => this.host.openText('隐私政策', PRIVACY_POLICY), w / 4 - 10, yy);
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
      `挂机 ${formatNumber(core.goldPerMin())} 金币/分 · ${formatNumber(core.expPerMin())} 经验/分 · 等级 ${core.teamIds().map((id) => s.beasts[id].level).join('/')}`,
      `金币 ${formatNumber(s.gold)} · 经验 ${formatNumber(s.exp)} · 背包 ${s.bag.length} 件`,
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
