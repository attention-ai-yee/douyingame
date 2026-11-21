import { _decorator, Component, game, Graphics, Label, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { ChestClaim, formatDuration, formatNumber, PullResult, SigninReward } from '../../core';
import { makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';
import { alignedLabel, currencyPill, Floater, floatText, iconButton, popup, redDot, skinButton, SkinButton, toast } from '../ui/Widgets';
import { BagPopup } from './BagPopup';
import { BattleView } from './BattleView';
import { BeastDetail } from './BeastDetail';
import { itemName, makeItemIcon } from './ItemIcon';
import { BeastsPage, BookPage, describePull, MainHooks, MorePage, MountainPage, Page, PageHost } from './Pages';
import { StageView } from './StageView';

const { ccclass } = _decorator;
const OL = '#4a2f27';

type TabKey = 'battle' | 'beasts' | 'mountain' | 'book' | 'more';
const TABS: { key: TabKey; name: string }[] = [
  { key: 'battle', name: '挂机' },
  { key: 'beasts', name: '异兽' },
  { key: 'mountain', name: '进山' },
  { key: 'book', name: '图鉴' },
  { key: 'more', name: '更多' },
];

/** 掉落飞向宝箱：从 (x0,y0) 弧线飞到 (x1,y1)，到了以后回调。 */
@ccclass('LootFly')
export class LootFly extends Component {
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  dur = 0.7;
  onArrive: (() => void) | null = null;
  private t = 0;

  update(dt: number): void {
    this.t += dt;
    const p = Math.min(1, this.t / this.dur);
    const e = p * p;
    const x = this.x0 + (this.x1 - this.x0) * e;
    const y = this.y0 + (this.y1 - this.y0) * e + Math.sin(p * Math.PI) * 120;
    this.node.setPosition(x, y);
    const k = 1 - 0.4 * p;
    this.node.setScale(k, k, 1);
    if (p >= 1) {
      if (this.onArrive) this.onArrive();
      this.node.destroy();
    }
  }
}

/**
 * 主界面（游戏设计文档 13.1）。底部 5 个页签：挂机 / 异兽 / 进山 / 图鉴 / 更多。
 * 「挂机」页就是首页：队伍在当前地图一直打小怪（不推关），打倒的小怪掉落飞进挂机宝箱，点宝箱领取；
 * 下方是上阵异兽、一键升级、一键穿戴。闯关在「进山」，抽异兽在「异兽 → 寻兽」。
 */
@ccclass('MainView')
export class MainView extends Component implements PageHost {
  static open(parent: Node, hooks: MainHooks): MainView {
    const n = uiNode('MainView', parent);
    const v = n.addComponent(MainView);
    v.setup(hooks);
    return v;
  }

  hooks!: MainHooks;
  private W = 750;
  private H = 1334;
  private goldL!: Label;
  private expL!: Label;
  private ticketL!: Label;
  private powerL!: Label;
  private stageL!: Label;
  private stageR!: Label;
  private signinBtn!: { node: Node; dot: Node };
  private wildBtn!: { node: Node; dot: Node; title: Label };
  private chest!: Node;
  private chestBar!: Graphics;
  private chestL!: Label;
  private chestFullShown = false;
  private chestX = 0;
  private chestY = 0;
  private battleY = 0;
  private team!: Node;
  private teamSig = '';
  private upgradeBtn!: SkinButton;
  private equipBtn!: SkinButton;
  private equipDot!: Node;
  private infoL!: Label;
  private pageRoot!: Node;
  private overlay!: Node;
  private pages: Partial<Record<TabKey, Page>> = {};
  private tabIcons: Partial<Record<TabKey, Node>> = {};
  private tabDots: Partial<Record<TabKey, Node>> = {};
  private current: TabKey = 'battle';
  private popupOpen = false;
  private signinAutoShown = false;
  private refreshT = 1;

  private setup(hooks: MainHooks): void {
    this.hooks = hooks;
    const vs = visibleSize();
    this.W = vs.width;
    this.H = vs.height;
    const W = this.W;
    const top = this.H / 2;
    const bottom = -this.H / 2;

    // 底图
    if (Skin.has('bg_main')) makeSprite(this.node, 'bg_main', W, this.H);
    else {
      const g = uiNode('Bg', this.node).addComponent(Graphics);
      g.fillColor = hex('#fff3dc');
      g.rect(-W / 2, -this.H / 2, W, this.H);
      g.fill();
    }

    // 上半屏：挂机战斗
    const battleTop = top - 170;
    this.battleY = battleTop - 290;
    BattleView.create(this.node, W, 580, 0, this.battleY, { kind: 'idle' }, { onLoot: (x, y) => this.onLoot(x, y) });

    // 挂机宝箱（战斗区右下角）
    this.chestX = W / 2 - 92;
    this.chestY = this.battleY - 290 + 96;
    this.chest = makeSprite(this.node, 'chest_box', 150, 150, this.chestX, this.chestY + 14, { fallback: '#c9773b' });
    this.chest.on(Node.EventType.TOUCH_END, () => this.showChest(false));
    const barBg = uiNode('ChestBar', this.node, this.chestX, this.chestY - 62);
    this.chestBar = barBg.addComponent(Graphics);
    this.chestL = makeLabel(this.node, '', 20, '#ffffff', this.chestX, this.chestY - 62);

    // 右上悬浮按钮（在战斗区的天空里）
    this.signinBtn = iconButton(this.node, 'icon_signin', 86, '签到', () => this.showSignin(), W / 2 - 58, battleTop - 66);
    this.wildBtn = iconButton(this.node, 'icon_wild', 86, '野遇', () => this.claimWild(), W / 2 - 158, battleTop - 66);
    this.wildBtn.node.active = false;

    // 上阵异兽
    const teamY = top - 870;
    makeSprite(this.node, 'panel_paper', W - 30, 214, 0, teamY, { fallback: '#fff8ea' });
    const tag = makeSprite(this.node, 'pill', 150, 46, -W / 2 + 110, teamY + 104, { fallback: '#fffaf0' });
    makeLabel(tag, '上阵异兽', 22, OL);
    this.team = uiNode('Team', this.node, 0, teamY);

    // 一键升级 / 一键穿戴
    const upY = top - 1030;
    this.upgradeBtn = skinButton(this.node, 'btn_red', '一键升级', 430, 112, () => this.onUpgrade(), -W / 2 + 245, upY, '');
    this.equipBtn = skinButton(this.node, 'btn_gold', '一键穿戴', 240, 104, () => this.onEquipBest(), W / 2 - 145, upY);
    this.equipDot = redDot(this.equipBtn.node, 104, 36);
    this.infoL = makeLabel(this.node, '', 22, '#8a6d55', 0, top - 1108);

    // 页签页面（盖在战斗区和阵位上）
    this.pageRoot = uiNode('Pages', this.node);

    // 顶栏与关卡条
    this.goldL = currencyPill(this.node, 'icon_gold', -W / 2 + 104, top - 52, 190);
    this.expL = currencyPill(this.node, 'icon_exp', -W / 2 + 290, top - 52, 170);
    this.ticketL = currencyPill(this.node, 'icon_ticket', W / 2 - 288, top - 52, 140);
    this.powerL = currencyPill(this.node, 'icon_power', W / 2 - 104, top - 52, 190);
    const bar = makeSprite(this.node, 'pill', W - 50, 60, 0, top - 128, { fallback: '#fffaf0' });
    this.stageL = alignedLabel(bar, '', 24, OL, -(W - 50) / 2 + 28, 0, 'left');
    this.stageR = alignedLabel(bar, '', 22, OL, (W - 50) / 2 - 28, 0, 'right');

    // 底部页签
    makeSprite(this.node, 'tab_bar', W, 170, 0, bottom + 85, { fallback: '#fffaf0' });
    TABS.forEach((t, i) => {
      const x = (i - 2) * (W / 5);
      const icon = makeSprite(this.node, `tab_${t.key}_off`, 100, 100, x, bottom + 104, { fallback: '#d9cfc2' });
      icon.on(Node.EventType.TOUCH_END, () => this.switchTab(t.key));
      makeLabel(this.node, t.name, 24, OL, x, bottom + 34);
      this.tabIcons[t.key] = icon;
      const dot = redDot(this.node, x + 38, bottom + 144);
      dot.active = false;
      this.tabDots[t.key] = dot;
    });
    // 闯关界面、详情弹窗都放在最上层
    this.overlay = uiNode('Overlay', this.node);
    this.switchTab('battle');

    App.core.events.on('offline', (r) => {
      if (r.ms >= App.cfg.progression.chest.popupMinMinutes * 60000) this.showChest(true);
    });
  }

  // ------------------------------------------------------------ 每帧

  update(dt: number): void {
    if (!App.ready) return;
    this.refreshT += dt;
    if (this.refreshT < 0.25) return;
    this.refreshT = 0;
    const core = App.core;
    const s = core.state;
    setLabel(this.goldL, formatNumber(s.gold));
    setLabel(this.expL, formatNumber(s.exp));
    setLabel(this.ticketL, String(s.tickets));
    setLabel(this.powerL, formatNumber(core.teamPower()));
    const chs = App.cfg.stages.chapters;
    const ch = chs[Math.min(core.f.chapterOfStage(Math.max(1, s.stage)), chs.length) - 1];
    setLabel(this.stageL, `${ch.name.split('·')[0]} · 已通关 ${s.stage} 关`);
    setLabel(this.stageR, `挂机 金币 +${formatNumber(core.goldPerMin())}/分`);
    if (core.fillEmptySlots()) App.save();
    this.signinBtn.dot.active = core.canClaimSignin();
    this.wildBtn.node.active = s.wildStore > 0;
    this.refreshChest();
    this.refreshTeam();
    this.refreshUpgrade();
    const canBeat = core.canBeatNextStage();
    (this.tabDots.mountain as Node).active = canBeat;
    (this.tabDots.beasts as Node).active = core.hasEquipUpgrade() || Object.keys(s.beasts).some((id) => core.canStarUp(id, true));
    const page = this.pages[this.current];
    if (page) page.refresh();
    if (!this.popupOpen && !this.signinAutoShown && !this.hooks.getAutoPlay() && core.canClaimSignin()) {
      this.signinAutoShown = true;
      this.showSignin();
    }
  }

  // ------------------------------------------------------------ 挂机宝箱

  private refreshChest(): void {
    const core = App.core;
    const c = App.cfg.progression.chest;
    const ms = core.state.chest.ms;
    const frac = Math.min(1, ms / (c.capHours * 3600e3));
    const full = core.chestFull();
    if (full !== this.chestFullShown) {
      this.chestFullShown = full;
      setSprite(this.chest, full ? 'chest_box_full' : 'chest_box', 150, 150, { fallback: '#c9773b' });
    }
    const g = this.chestBar;
    const w = 130;
    g.clear();
    g.fillColor = hex('#16181d', 190);
    g.roundRect(-w / 2, -14, w, 28, 14);
    g.fill();
    if (frac > 0) {
      g.fillColor = hex(full ? '#ff7b4a' : '#ffc43d');
      g.roundRect(-w / 2 + 3, -11, Math.max(22, (w - 6) * frac), 22, 11);
      g.fill();
    }
    setLabel(this.chestL, full ? '已满！点我领取' : ms < 60000 ? '挂机中…' : formatDuration(ms));
  }

  /** 挂机打倒一只小怪：金币、经验（偶尔是装备）飞进宝箱。 */
  private onLoot(x: number, y: number): void {
    if (this.current !== 'battle') return;
    const wx = x;
    const wy = this.battleY + y;
    const icons = ['icon_gold', 'icon_exp'];
    if (Math.random() < 0.25) icons.push(`equip_${Math.floor(Math.random() * 4)}`);
    icons.forEach((name, i) => {
      const n = makeSprite(this.node, name, 46, 46, wx, wy, { optional: true });
      // 放在宝箱下面一层也没关系：飞行很快，宝箱会"吞"掉它
      const f = n.addComponent(LootFly);
      f.x0 = wx + (i - 1) * 24;
      f.y0 = wy + 20;
      f.x1 = this.chestX;
      f.y1 = this.chestY + 20;
      f.dur = 0.6 + i * 0.12;
      f.onArrive = () => this.bumpChest();
    });
  }

  private bumpChest(): void {
    this.chest.setScale(1.12, 1.12, 1);
    this.scheduleOnce(() => this.chest.setScale(1, 1, 1), 0.08);
  }

  /** 宝箱弹窗。auto 为回到游戏时自动弹出（显示"离开了多久"）。 */
  private showChest(auto: boolean): void {
    if (this.popupOpen) return;
    const core = App.core;
    const ch = core.state.chest;
    if (core.chestEmpty()) {
      if (!auto) this.toast('宝箱还是空的，挂机一会儿再来');
      return;
    }
    this.popupOpen = true;
    const mult = App.ads.countToday('offline_double') === 0 ? 3 : 2;
    const pop = popup(this.overlay, '挂机收获', 640, 760, () => {
      this.popupOpen = false;
    });
    const body = pop.body;
    makeLabel(body, `${auto ? '你不在的时候，异兽们一直在打怪\n' : ''}已经攒了 ${formatDuration(ch.ms)}（最多 ${App.cfg.progression.chest.capHours} 小时）`, 24, '#8a6d55', 0, 270).lineHeight = 36;
    const row = (icon: string, text: string, y: number) => {
      makeSprite(body, icon, 64, 64, -170, y, { optional: true });
      alignedLabel(body, text, 34, OL, -120, y, 'left');
    };
    row('icon_gold', `+${formatNumber(ch.gold)}`, 170);
    row('icon_exp', `+${formatNumber(ch.exp)}`, 96);
    let y = 22;
    if (ch.tickets) {
      row('icon_ticket', `寻兽符 +${ch.tickets}`, y);
      y -= 70;
    }
    if (ch.fanShards) {
      makeLabel(body, `凡级万能星魄 +${ch.fanShards}`, 26, OL, 0, y);
      y -= 56;
    }
    if (ch.items.length) {
      makeLabel(body, `装备 ×${ch.items.length}`, 26, OL, 0, y);
      y -= 70;
      const show = ch.items.slice().sort((a, b) => core.itemPct(b) - core.itemPct(a)).slice(0, 5);
      show.forEach((it, i) => makeItemIcon(body, it, 84, (i - (show.length - 1) / 2) * 100, y));
    }
    const claim = (m: number) => {
      const got = core.claimChest(m);
      App.analytics.track('chest_claim', { minutes: Math.round(got.ms / 60000), mult: m, items: got.items.length });
      // 领完顺手把更好的装备穿上（玩家最常做的事）
      const n = core.equipBest();
      App.save();
      this.toast(this.describeClaim(got, n));
      pop.close();
    };
    skinButton(body, 'btn_ink', '领取', 230, 96, () => claim(1), -150, -290);
    const ad = skinButton(body, 'btn_gold', `看视频 ×${mult}`, 270, 96, async () => {
      const r = await App.ads.showRewarded('offline_double');
      if (!r.granted) {
        this.toast('没有看完视频，按原数量领取');
        claim(1);
      } else claim(1 + (mult - 1) * r.ratio);
    }, 140, -290, '金币经验翻倍');
    if (App.ads.available('offline_double')) App.ads.markOffered('offline_double');
    else ad.setEnabled(false);
  }

  private describeClaim(c: ChestClaim, equipped: number): string {
    const parts = [`金币 +${formatNumber(c.gold)}`, `经验 +${formatNumber(c.exp)}`];
    if (c.tickets) parts.push(`寻兽符 +${c.tickets}`);
    if (c.items.length) parts.push(`装备 ×${c.items.length}`);
    return parts.join('　') + (equipped ? `\n自动换上了 ${equipped} 件更好的装备` : '');
  }

  // ------------------------------------------------------------ 阵位与升级

  private refreshTeam(): void {
    const core = App.core;
    const s = core.state;
    const k = core.slotsAvailable();
    const sig = s.team.join(',') + '|' + k + '|' + s.team.map((id) => (id && s.beasts[id] ? `${s.beasts[id].level}.${s.beasts[id].star}` : '')).join(',');
    if (sig === this.teamSig) return;
    this.teamSig = sig;
    for (const c of this.team.children.slice()) c.destroy();
    const unlocks = App.cfg.progression.slots.unlocks;
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 138;
      if (i >= k) {
        const need = unlocks.filter((u) => u.slots > i).map((u) => u.stage)[0];
        const lock = uiNode('Locked', this.team, x, 18);
        const g = lock.addComponent(Graphics);
        g.fillColor = hex('#efe7db');
        g.circle(0, 0, 54);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = hex('#c9b8a2');
        g.circle(0, 0, 54);
        g.stroke();
        makeLabel(lock, need !== undefined ? `第${need}关` : '未开放', 22, '#a08a76');
        makeLabel(this.team, '未开放', 22, '#a08a76', x, -62);
        continue;
      }
      const id = s.team[i];
      const slot = uiNode('Slot', this.team, x, 0);
      const ut = slot.addComponent(UITransform);
      ut.setContentSize(130, 200);
      if (id && s.beasts[id]) {
        makeBeastIcon(slot, id, 108, 0, 18, {});
        makeLabel(slot, `Lv.${s.beasts[id].level}`, 24, OL, 0, -62);
        slot.on(Node.EventType.TOUCH_END, () => this.openBeast(id));
      } else {
        makeLabel(slot, '空', 30, '#a08a76', 0, 18);
        slot.on(Node.EventType.TOUCH_END, () => this.switchTab('beasts'));
      }
    }
  }

  private refreshUpgrade(): void {
    const core = App.core;
    const cost = core.nextTeamUpgradeCost();
    const ok = !!cost && core.state.gold >= cost.gold && core.state.exp >= cost.exp;
    this.upgradeBtn.setText('一键升级', cost ? `金币 ${formatNumber(cost.gold)} · 经验 ${formatNumber(cost.exp)}` : '');
    this.upgradeBtn.setEnabled(ok);
    const better = core.hasEquipUpgrade();
    this.equipDot.active = better;
    let info: string;
    if (core.chestFull()) info = '挂机宝箱满了，快点宝箱领取！';
    else if (core.canBeatNextStage()) {
      const n = core.nextStage();
      info = n ? `战力够了，去「进山」挑战第 ${n.stage - (n.chapter - 1) * App.cfg.stages.chapterLength} 关吧` : '';
    } else if (ok) info = '金币经验够了，点「一键升级」变强！';
    else if (better) info = '背包里有更好的装备，点「一键穿戴」';
    else info = '挂机产出都在宝箱里，点宝箱领取 · 离线也在攒';
    setLabel(this.infoL, info);
  }

  private onUpgrade(): void {
    const n = App.core.upgradeTeam();
    if (n <= 0) {
      this.toast('金币或经验不够，挂机攒一会再领宝箱');
      return;
    }
    App.analytics.track('team_level_up', { levels: n });
    App.save();
    floatText(this.node, `升了 ${n} 级！`, -this.W / 2 + 245, this.H / 2 - 960, 32, '#ff5a5a', 0.9, 50);
    this.teamSig = '';
  }

  private onEquipBest(): void {
    const n = App.core.equipBest();
    if (!n) {
      this.toast(App.core.state.bag.length ? '已经穿着最好的装备了' : '还没有装备，挂机宝箱和 Boss 关会掉');
      return;
    }
    App.save();
    this.toast(`换上了 ${n} 件更好的装备`);
  }

  // ------------------------------------------------------------ 页签

  switchTab(k: TabKey): void {
    this.current = k;
    const W = this.W;
    const pageH = this.H - 335;
    const pageY = (this.H / 2 - 170 + (-this.H / 2 + 165)) / 2;
    if (k !== 'battle' && !this.pages[k]) {
      const make: Record<Exclude<TabKey, 'battle'>, () => Page> = {
        beasts: () => new BeastsPage(this, this.pageRoot, W - 24, pageH, pageY),
        mountain: () => new MountainPage(this, this.pageRoot, W - 24, pageH, pageY),
        book: () => new BookPage(this, this.pageRoot, W - 24, pageH, pageY),
        more: () => new MorePage(this, this.pageRoot, W - 24, pageH, pageY),
      };
      this.pages[k] = make[k as Exclude<TabKey, 'battle'>]();
    }
    for (const key in this.pages) {
      const p = this.pages[key as TabKey];
      if (p) p.node.active = key === k;
    }
    const page = this.pages[k];
    if (page) page.refresh();
    TABS.forEach((t, i) => {
      const icon = this.tabIcons[t.key];
      if (!icon) return;
      const on = t.key === k;
      const size = on ? 116 : 100;
      setSprite(icon, `tab_${t.key}_${on ? 'on' : 'off'}`, size, size, { fallback: on ? '#ff7b7b' : '#d9cfc2' });
      icon.setPosition((i - 2) * (W / 5), -this.H / 2 + (on ? 116 : 104));
    });
  }

  // ------------------------------------------------------------ PageHost

  toast(text: string): void {
    toast(this.overlay, text, this.H / 2 - 260);
  }

  openBeast(id: string): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    BeastDetail.open(this.overlay, id, (t) => this.toast(t), () => {
      this.popupOpen = false;
      this.teamSig = '';
    });
  }

  openBag(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    BagPopup.open(this.overlay, (t) => this.toast(t), () => {
      this.popupOpen = false;
    });
  }

  openStage(kind: 'stage' | 'tower'): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    App.analytics.track('stage_open', { kind, stage: App.core.state.stage, floor: App.core.state.floor });
    StageView.open(this.overlay, kind, {
      onClose: (goUpgrade) => {
        this.popupOpen = false;
        if (goUpgrade) this.switchTab('battle');
      },
    });
  }

  doPull(mountainId: string, count: number): void {
    const res = App.core.pull(mountainId, count);
    if (!res.ok) {
      this.toast(res.reason === 'tickets' ? '寻兽符不够了，看视频可以领' : '这座山还没开放');
      return;
    }
    App.analytics.track('pull', { mountain: mountainId, count, free: count === 10 && res.results.length === 10 });
    App.save();
    this.showPullResults(res.results);
  }

  showRates(): void {
    const pop = popup(this.overlay, '概率说明', 680, 900);
    const lines: string[] = [];
    const cfg = App.cfg;
    for (const m of App.core.mountains()) {
      if (!m.unlocked || !m.depth) {
        lines.push(`【${m.name}】未开放`);
        continue;
      }
      const d = cfg.pools.depths[m.depth];
      lines.push(`【${m.name} · ${d.name}】凡 ${pct(d.rates.fan)} 灵 ${pct(d.rates.ling)} 稀 ${pct(d.rates.xi)} 传说 ${pct(d.rates.chuanshuo)}`);
      const def = cfg.pools.mountains.filter((x) => x.id === m.id)[0];
      for (const r of ['chuanshuo', 'xi'] as const) {
        const tier = def.tiers[r];
        const sum = tier.reduce((a, x) => a + x[1], 0);
        if (d.rates[r] > 0) lines.push('  ' + tier.map(([id, w]) => `${App.core.idx.beast[id].name} ${pct((d.rates[r] * w) / sum, 2)}`).join('  '));
      }
    }
    lines.push('');
    lines.push(`保底：连续 ${cfg.pools.pity.xi} 次没出稀有，下一次必出稀有；`);
    lines.push(`连续 ${cfg.pools.pity.chuanshuo} 次没出传说，下一次必出传说。`);
    lines.push('十连至少出一只灵兽；闪光概率 1%。');
    const l = makeLabel(pop.body, lines.join('\n'), 22, OL, 0, 0);
    l.lineHeight = 36;
  }

  resetSave(): void {
    App.resetAndRestart(() => {
      if (App.platform.name === 'web' && typeof location !== 'undefined') location.reload();
      else game.restart();
    });
  }

  // ------------------------------------------------------------ 弹窗

  private showPullResults(results: PullResult[]): void {
    const pop = popup(this.overlay, results.length >= 10 ? '寻兽十连' : '寻兽收获', 680, results.length >= 10 ? 640 : 460);
    const cols = 5;
    results.forEach((r, i) => {
      const x = (i % cols - (Math.min(cols, results.length) - 1) / 2) * 124;
      const y = results.length > 5 ? 120 - Math.floor(i / cols) * 200 : 40;
      makeBeastIcon(pop.body, r.beastId, 96, x, y, {});
      makeLabel(pop.body, App.core.idx.beast[r.beastId].name, 22, OL, x, y - 66);
      if (r.isNew) {
        const t = makeSprite(pop.body, 'btn_red', 56, 30, x + 34, y + 44, { fallback: '#ff5a5a' });
        makeLabel(t, '新', 18, '#ffffff', 0, 2);
      }
      if (r.shiny) makeLabel(pop.body, '✦闪光', 18, '#e8a317', x - 30, y + 46);
    });
    const rare = results.filter((r) => r.needsReveal).length;
    makeLabel(pop.body, rare ? `有 ${rare} 只稀有异兽现身，快去拍符！` : describePull(results), 24, '#8a6d55', 0, results.length > 5 ? -190 : -70);
  }

  private showSignin(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    const core = App.core;
    const cfg = App.cfg.signin;
    const st = core.state.signin;
    const list = st.round === 0 ? cfg.firstRound : cfg.laterRounds;
    const can = core.canClaimSignin();
    const pop = popup(this.overlay, st.round === 0 ? '七日签到' : '每日签到', 690, 860, () => {
      this.popupOpen = false;
    });
    list.forEach((r, i) => {
      const row = i < 4 ? 0 : 1;
      const col = row === 0 ? i : i - 4;
      const x = row === 0 ? (col - 1.5) * 160 : (col - 1) * 160;
      const y = row === 0 ? 220 : 10;
      const claimed = i < st.claimedInRound;
      const today = i === st.claimedInRound && can;
      const cell = uiNode('Day', pop.body, x, y);
      const g = cell.addComponent(Graphics);
      g.fillColor = hex(claimed ? '#e8e0d4' : today ? '#fff1c2' : '#ffffff');
      g.roundRect(-70, -90, 140, 180, 18);
      g.fill();
      g.lineWidth = today ? 6 : 3;
      g.strokeColor = hex(today ? '#ffb020' : OL);
      g.roundRect(-70, -90, 140, 180, 18);
      g.stroke();
      makeLabel(cell, `第${r.day}天`, 24, OL, 0, 64);
      if (r.beast) makeBeastIcon(cell, r.beast, 70, 0, 10, {});
      makeLabel(cell, describeSignin(r), 18, '#6b5444', 0, r.beast ? -50 : 0);
      if (claimed) makeLabel(cell, '已领取', 22, '#3fcf7f', 0, -72);
      else if (today) makeLabel(cell, '今天', 22, '#ff5a5a', 0, -72);
    });
    if (!can) {
      makeLabel(pop.body, '今天已经签到啦，明天再来！', 28, OL, 0, -200);
      return;
    }
    const today = core.state.signin.claimedInRound;
    const reward = list[today];
    const finish = (choice?: string) => {
      const res = core.claimSignin(choice);
      if (!res) {
        // 例如自动模式已经替你领过了：关掉弹窗并说明，不能没反应
        pop.close();
        this.toast(core.canClaimSignin() ? '领取失败，请重试' : '今天已经签到过了');
        return;
      }
      App.save();
      this.toast(`签到成功：${describeSignin(res.reward, choice)}`);
      pop.close();
    };
    if (reward.choice) {
      makeLabel(pop.body, '三选一，点击领取：', 26, OL, 0, -130);
      reward.choice.forEach((id, k) => {
        const x = (k - 1) * 190;
        const icon = makeBeastIcon(pop.body, id, 110, x, -240, {});
        const ut = icon.node.addComponent(UITransform);
        ut.setContentSize(130, 130);
        icon.node.on(Node.EventType.TOUCH_END, () => finish(id));
        makeLabel(pop.body, App.core.idx.beast[id].name, 24, OL, x, -320);
      });
    } else {
      skinButton(pop.body, 'btn_red', '签到领取', 320, 104, () => finish(), 0, -230);
    }
  }

  private claimWild(): void {
    const got = App.core.claimStoredWild();
    if (got.length) {
      App.save();
      this.toast(`遇到了 ${got.length} 只野生异兽！`);
    } else this.toast('今天的野遇次数用完了');
  }
}

function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function describeSignin(r: SigninReward, choice?: string): string {
  const parts: string[] = [];
  if (r.beast) parts.push(App.core.idx.beast[r.beast].name);
  if (r.choice) parts.push(choice ? App.core.idx.beast[choice].name : '灵兽\n三选一');
  if (r.tickets) parts.push(`寻兽符×${r.tickets}`);
  if (r.wild) for (const k in r.wild) parts.push(`万能星魄×${r.wild[k as 'ling']}`);
  if (r.goldMinutes) parts.push(`金币经验\n(${r.goldMinutes}分钟)`);
  return parts.join('\n');
}
