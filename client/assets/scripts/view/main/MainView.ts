import { _decorator, Component, game, Graphics, Label, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { ChestClaim, formatDuration, formatNumber, SigninReward } from '../../core';
import { makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';
import { alignedLabel, currencyPill, Floater, floatText, iconButton, popup, redDot, skinButton, SkinButton, toast } from '../ui/Widgets';
import { BagPopup } from './BagPopup';
import { BattleView } from './BattleView';
import { BeastDetail } from './BeastDetail';
import { itemName, makeItemIcon } from './ItemIcon';
import { GuideView, registerGuideTarget } from './GuideView';
import { LootFly } from './LootFly';
import { MapPage } from './MapPage';
import { BeastsPage, BookPage, MainHooks, MorePage, Page, PageHost } from './Pages';
import { PullRevealView } from './PullRevealView';
import { StageView } from './StageView';
import { TasksPopup } from './TasksPopup';
import { TextPopup } from '../more/TextPopup';

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
  /** 顶栏（所有页签共用）。 */
  private hudBand!: Node;
  private avatar!: Node;
  private avatarId = '';
  private goldL!: Label;
  private expL!: Label;
  private ticketL!: Label;
  private powerL!: Label;
  /** 挂机页（首页）的内容。 */
  private home!: Node;
  private stageL!: Label;
  private stageSubL!: Label;
  private hint!: Node;
  private hintL!: Label;
  private hintTab: TabKey = 'mountain';
  private signinBtn!: { node: Node; dot: Node };
  private wildBtn!: { node: Node; dot: Node; title: Label };
  private taskBtn!: { node: Node; dot: Node; title: Label };
  private chest!: Node;
  private chestGlow!: Graphics;
  private chestBar!: Graphics;
  private chestL!: Label;
  private chestBubble!: Node;
  private chestFullShown = false;
  private chestX = 0;
  private chestY = 0;
  private battleY = 0;
  private pageRoot!: Node;
  private overlay!: Node;
  private pages: Partial<Record<TabKey, Page>> = {};
  private tabIcons: Partial<Record<TabKey, Node>> = {};
  private tabDots: Partial<Record<TabKey, Node>> = {};
  private current: TabKey = 'battle';
  private popupOpen = false;
  private pullView: PullRevealView | null = null;
  private signinAutoShown = false;
  private refreshT = 1;
  private t = 0;

  private setup(hooks: MainHooks): void {
    this.hooks = hooks;
    const vs = visibleSize();
    this.W = vs.width;
    this.H = vs.height;
    const W = this.W;
    const top = this.H / 2;
    const bottom = -this.H / 2;
    const tabTop = bottom + 170;

    // 底色（页签页面、加载时露出来的部分）
    const bg = uiNode('Bg', this.node).addComponent(Graphics);
    bg.fillColor = hex('#fff3dc');
    bg.rect(-W / 2, -this.H / 2, W, this.H);
    bg.fill();

    // ---------------- 挂机页（首页）：战斗铺满顶栏到页签之间
    this.home = uiNode('Home', this.node);
    const battleH = top - tabTop;
    this.battleY = (top + tabTop) / 2;
    BattleView.create(this.home, W, battleH, 0, this.battleY, { kind: 'idle' }, { onLoot: (x, y) => this.onLoot(x, y) }, {
      scale: 1.15,
      spreadX: 1,
      spreadY: 1,
      offsetX: 0,
      offsetY: 0,
      hideBanner: true,
      // 前排 2 只、后排 3 只错开，都在宝箱上方
      positions: [
        [-100, -60],
        [-100, -250],
        [-262, 30],
        [-262, -155],
        [-262, -340],
      ],
    });
    // 顶部渐隐，让顶栏和横幅看得清
    const fade = uiNode('Fade', this.home).addComponent(Graphics);
    for (let k = 0; k < 12; k++) {
      fade.fillColor = hex('#fff3dc', Math.round(235 * (1 - k / 12)));
      fade.rect(-W / 2, top - 130 - k * 12, W, 12);
      fade.fill();
    }
    fade.fillColor = hex('#fff3dc', 235);
    fade.rect(-W / 2, top - 130, W, 130);
    fade.fill();
    // 关卡横幅 + 下一步提示
    const banner = makeSprite(this.home, 'banner', 420, 84, 0, top - 172, { fallback: '#fffaf0' });
    this.stageL = makeLabel(banner, '', 30, OL, 0, 12);
    this.stageSubL = makeLabel(banner, '', 19, '#8a6d55', 0, -20);
    this.hint = makeSprite(this.home, 'btn_jade', 400, 50, 0, top - 246, { fallback: '#2f8f68' });
    this.hintL = makeLabel(this.hint, '', 22, '#ffffff', 0, 3);
    this.hint.on(Node.EventType.TOUCH_END, () => this.switchTab(this.hintTab));
    // 左侧小图标
    const lx = -W / 2 + 62;
    this.signinBtn = iconButton(this.home, 'icon_signin', 88, '签到', () => this.showSignin(), lx, top - 330);
    registerGuideTarget('signin_btn', this.signinBtn.node, 'battle');
    this.taskBtn = iconButton(this.home, 'icon_task', 88, '任务', () => this.openTasks(), lx, top - 450);
    this.wildBtn = iconButton(this.home, 'icon_wild', 88, '野遇', () => this.claimWild(), lx, top - 570);
    this.wildBtn.node.active = false;
    // 挂机宝箱：底部正中，最主要的操作
    this.chestX = 0;
    this.chestY = tabTop + 150;
    this.chestGlow = uiNode('Glow', this.home, this.chestX, this.chestY).addComponent(Graphics);
    this.chest = makeSprite(this.home, 'chest_box', 184, 184, this.chestX, this.chestY, { fallback: '#c9773b' });
    registerGuideTarget('chest', this.chest, 'battle');
    this.chest.on(Node.EventType.TOUCH_END, () => this.showChest(false));
    this.chestBar = uiNode('ChestBar', this.home, this.chestX, this.chestY - 104).addComponent(Graphics);
    this.chestL = makeLabel(this.home, '', 21, '#ffffff', this.chestX, this.chestY - 104);
    this.chestBubble = makeSprite(this.home, 'pill', 150, 46, this.chestX + 150, this.chestY + 70, { fallback: '#ffffff' });
    makeLabel(this.chestBubble, '点我领取！', 22, OL);

    // ---------------- 页签页面
    this.pageRoot = uiNode('Pages', this.node);

    // ---------------- 顶栏（所有页签共用）
    const hud = uiNode('Hud', this.node);
    this.hudBand = uiNode('Band', hud);
    const band = this.hudBand.addComponent(Graphics);
    band.fillColor = hex('#fff3dc');
    band.rect(-W / 2, top - 120, W, 120);
    band.fill();
    band.fillColor = hex('#e3c999');
    band.rect(-W / 2, top - 124, W, 4);
    band.fill();
    const ring = uiNode('AvatarRing', hud, -W / 2 + 68, top - 64).addComponent(Graphics);
    ring.fillColor = hex('#fff1c2');
    ring.circle(0, 0, 46);
    ring.fill();
    ring.lineWidth = 5;
    ring.strokeColor = hex(OL);
    ring.circle(0, 0, 46);
    ring.stroke();
    this.avatar = uiNode('Avatar', hud, -W / 2 + 68, top - 64);
    alignedLabel(hud, '御兽师', 24, OL, -W / 2 + 124, top - 40, 'left');
    const pw = makeSprite(hud, 'pill', 150, 44, -W / 2 + 196, top - 84, { fallback: '#4a2f27', color: '#4a2f27' });
    makeSprite(pw, 'icon_power', 46, 46, -66, 2, { optional: true });
    this.powerL = makeLabel(pw, '', 24, '#ffd84d', 12, 0);
    this.goldL = currencyPill(hud, 'icon_gold', 10, top - 56, 170);
    this.expL = currencyPill(hud, 'icon_exp', 186, top - 56, 150);
    this.ticketL = currencyPill(hud, 'icon_ticket', 318, top - 56, 100);

    // ---------------- 底部页签
    makeSprite(this.node, 'tab_bar', W, 170, 0, bottom + 85, { fallback: '#fffaf0' });
    TABS.forEach((t, i) => {
      const x = (i - 2) * (W / 5);
      const icon = makeSprite(this.node, `tab_${t.key}_off`, 100, 100, x, bottom + 104, { fallback: '#d9cfc2' });
      icon.on(Node.EventType.TOUCH_END, () => this.switchTab(t.key));
      makeLabel(this.node, t.name, 24, OL, x, bottom + 34);
      this.tabIcons[t.key] = icon;
      registerGuideTarget(`tab_${t.key}`, icon);
      const dot = redDot(this.node, x + 38, bottom + 144);
      dot.active = false;
      this.tabDots[t.key] = dot;
    });
    // 闯关界面、详情弹窗都放在最上层
    this.overlay = uiNode('Overlay', this.node);
    // 新手引导的指引层盖在最上面（拍符界面除外）
    GuideView.create(this.node, {
      root: this.node,
      overlay: this.overlay,
      isModalOpen: () => this.popupOpen,
      currentTab: () => this.current,
      onFinished: () => this.toast('新手引导完成！\n挂机攒资源、升级变强，去进山一关关打过去吧'),
    });
    this.switchTab('battle');

    App.core.events.on('offline', (r) => {
      if (r.ms >= App.cfg.progression.chest.popupMinMinutes * 60000) this.showChest(true);
    });
  }

  // ------------------------------------------------------------ 每帧

  update(dt: number): void {
    if (!App.ready) return;
    this.t += dt;
    this.animateChest();
    this.refreshT += dt;
    if (this.refreshT < 0.25) return;
    this.refreshT = 0;
    const core = App.core;
    const s = core.state;
    setLabel(this.goldL, formatNumber(s.gold));
    setLabel(this.expL, formatNumber(s.exp));
    setLabel(this.ticketL, String(s.tickets));
    setLabel(this.powerL, formatNumber(core.teamPower()));
    this.refreshAvatar();
    if (core.fillEmptySlots()) App.save();
    this.signinBtn.dot.active = core.canClaimSignin();
    this.wildBtn.node.active = s.wildStore > 0;
    this.taskBtn.dot.active = core.hasTaskReward();
    this.refreshHome();
    this.refreshChest();
    (this.tabDots.mountain as Node).active = core.canBeatNextStage();
    (this.tabDots.beasts as Node).active = this.beastsHaveWork();
    const page = this.pages[this.current];
    if (page) page.refresh();
    if (!this.popupOpen && !this.signinAutoShown && !this.hooks.getAutoPlay() && core.canClaimSignin()) {
      this.signinAutoShown = true;
      this.showSignin();
    }
  }

  /** 异兽页有事可做：能升级、能换更好的装备、能升星。 */
  private beastsHaveWork(): boolean {
    const core = App.core;
    const cost = core.nextTeamUpgradeCost();
    if (cost && core.state.gold >= cost.gold && core.state.exp >= cost.exp) return true;
    return core.hasEquipUpgrade() || Object.keys(core.state.beasts).some((id) => core.canStarUp(id, true));
  }

  /** 顶栏头像：上阵里战力最高的异兽。 */
  private refreshAvatar(): void {
    const ids = App.core.teamIds();
    const lead = ids.slice().sort((a, b) => App.core.unitPower(b) - App.core.unitPower(a))[0] || 'lei';
    if (lead === this.avatarId) return;
    this.avatarId = lead;
    for (const c of this.avatar.children.slice()) c.destroy();
    makeBeastIcon(this.avatar, lead, 86, 0, 2, { frame: null });
  }

  /** 首页横幅：所在地图、关卡、挂机收益；下面一行提示现在最该做什么。 */
  private refreshHome(): void {
    const core = App.core;
    const s = core.state;
    const chs = App.cfg.stages.chapters;
    const len = App.cfg.stages.chapterLength;
    const n = Math.max(1, s.stage);
    const chIdx = Math.min(core.f.chapterOfStage(n), chs.length);
    const local = s.stage === 0 ? 0 : s.stage - (chIdx - 1) * len;
    setLabel(this.stageL, `${chs[chIdx - 1].name.split('·')[0]} · ${s.stage === 0 ? '初入山海' : `第 ${local} 关`}`);
    setLabel(this.stageSubL, `挂机中 · 金币 +${formatNumber(core.goldPerMin())}/分 · 经验 +${formatNumber(core.expPerMin())}/分`);
    let hint = '';
    const next = core.nextStage();
    if (next && core.canBeatNextStage()) {
      hint = `战力够了，去挑战第 ${next.stage - (next.chapter - 1) * len} 关 ›`;
      this.hintTab = 'mountain';
    } else if (this.beastsHaveWork()) {
      hint = '异兽可以变强了，去看看 ›';
      this.hintTab = 'beasts';
    }
    this.hint.active = !!hint;
    if (hint) setLabel(this.hintL, hint);
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
      setSprite(this.chest, full ? 'chest_box_full' : 'chest_box', 184, 184, { fallback: '#c9773b' });
    }
    const g = this.chestBar;
    const w = 226;
    g.clear();
    g.fillColor = hex('#16181d', 200);
    g.roundRect(-w / 2, -17, w, 34, 17);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = hex(OL);
    g.roundRect(-w / 2, -17, w, 34, 17);
    g.stroke();
    if (frac > 0) {
      g.fillColor = hex(full ? '#ff7b4a' : '#ffc43d');
      g.roundRect(-w / 2 + 4, -13, Math.max(26, (w - 8) * frac), 26, 13);
      g.fill();
    }
    const capText = `${c.capHours}时`;
    setLabel(this.chestL, full ? '宝箱满了！快领取' : ms < 60000 ? '挂机中…' : `已攒 ${formatDuration(ms)} / ${capText}`);
    this.chestBubble.active = full || ms >= 30 * 60000;
  }

  /** 宝箱背后的光晕（越满越亮）和气泡的轻微跳动。 */
  private animateChest(): void {
    if (!this.chestGlow || this.current !== 'battle') return;
    const c = App.cfg.progression.chest;
    const frac = Math.min(1, App.core.state.chest.ms / (c.capHours * 3600e3));
    const g = this.chestGlow;
    g.clear();
    const pulse = 1 + 0.06 * Math.sin(this.t * 3);
    for (let k = 4; k >= 1; k--) {
      g.fillColor = hex('#fff3a8', Math.round((30 + 60 * frac) * (1 - k / 5)));
      g.circle(0, 0, (60 + k * 16) * pulse);
      g.fill();
    }
    if (this.chestBubble.active) this.chestBubble.setPosition(this.chestX + 150, this.chestY + 70 + 5 * Math.sin(this.t * 4));
  }

  /** 挂机打倒一只小怪：金币、经验（偶尔是装备）飞进宝箱。 */
  private onLoot(x: number, y: number): void {
    if (this.current !== 'battle') return;
    const wx = x;
    const wy = this.battleY + y;
    const icons = ['icon_gold', 'icon_exp'];
    if (Math.random() < 0.25) icons.push(`equip_${Math.floor(Math.random() * 4)}`);
    icons.forEach((name, i) => {
      const n = makeSprite(this.home, name, 46, 46, wx, wy, { optional: true });
      const f = n.addComponent(LootFly);
      f.x0 = wx + (i - 1) * 24;
      f.y0 = wy + 20;
      f.x1 = this.chestX;
      f.y1 = this.chestY + 10;
      f.dur = 0.6 + i * 0.12;
      f.onArrive = () => this.bumpChest();
    });
  }

  private bumpChest(): void {
    this.chest.setScale(1.1, 1.1, 1);
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
    const claimBtn = skinButton(body, 'btn_ink', '领取', 230, 96, () => claim(1), -150, -290);
    registerGuideTarget('chest_claim', claimBtn.node);
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

  // ------------------------------------------------------------ 页签

  switchTab(k: TabKey): void {
    this.current = k;
    const W = this.W;
    // 页面占满顶栏（120）和页签（170）之间
    const pageH = this.H - 290;
    const pageY = (this.H / 2 - 120 + (-this.H / 2 + 170)) / 2;
    this.home.active = k === 'battle';
    this.hudBand.active = k !== 'battle';
    if (k !== 'battle' && !this.pages[k]) {
      const make: Record<Exclude<TabKey, 'battle'>, () => Page> = {
        beasts: () => new BeastsPage(this, this.pageRoot, W, pageH, pageY),
        mountain: () => new MapPage(this, this.pageRoot, W, pageH, pageY),
        book: () => new BookPage(this, this.pageRoot, W, pageH, pageY),
        more: () => new MorePage(this, this.pageRoot, W, pageH, pageY),
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
    });
  }

  openText(title: string, text: string): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    TextPopup.open(this.overlay, title, text, () => {
      this.popupOpen = false;
    });
  }

  openTasks(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    TasksPopup.open(this.overlay, (t) => this.toast(t), () => {
      this.popupOpen = false;
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
    if (this.popupOpen) return;
    const before: Record<number, boolean> = {};
    for (const p of App.core.revealQueue) before[p.id] = true;
    const free = count === 10 && App.core.canFreeTenPull();
    const res = App.core.pull(mountainId, count);
    if (!res.ok) {
      this.toast(res.reason === 'tickets' ? '寻兽符不够了，看视频可以领' : '这座山还没开放');
      return;
    }
    App.analytics.track('pull', { mountain: mountainId, count, free });
    App.save();
    // 这次新进入拍符队列的（按顺序对应翻到的稀有卡）
    const revealIds = App.core.revealQueue.filter((p) => !before[p.id]).map((p) => p.id);
    this.popupOpen = true;
    this.pullView = PullRevealView.open(this.overlay, mountainId, res.results, revealIds, {
      onClose: (again) => {
        this.pullView = null;
        this.popupOpen = false;
        if (again) this.doPull(mountainId, 10);
      },
    });
  }

  /** 十连揭晓还没翻到稀有卡时，Boot 先不要弹现身拍符。 */
  holdReveals(): boolean {
    return !!this.pullView && this.pullView.holding;
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
      const btn = skinButton(pop.body, 'btn_red', '签到领取', 320, 104, () => finish(), 0, -230);
      registerGuideTarget('signin_claim', btn.node);
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
