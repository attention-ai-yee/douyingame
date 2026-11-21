import { _decorator, Component, game, Graphics, Label, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { formatDuration, formatNumber, PullResult, SigninReward } from '../../core';
import { makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode, visibleSize } from '../ui/UiKit';
import { alignedLabel, currencyPill, floatText, iconButton, popup, skinButton, SkinButton, toast } from '../ui/Widgets';
import { BattleView } from './BattleView';
import { BeastsPage, BookPage, describePull, MainHooks, MorePage, MountainPage, Page, PageHost } from './Pages';

const { ccclass } = _decorator;
const OL = '#4a2f27';

type TabKey = 'battle' | 'beasts' | 'mountain' | 'book' | 'more';
const TABS: { key: TabKey; name: string }[] = [
  { key: 'battle', name: '战斗' },
  { key: 'beasts', name: '异兽' },
  { key: 'mountain', name: '进山' },
  { key: 'book', name: '图鉴' },
  { key: 'more', name: '更多' },
];

/**
 * 主界面（游戏设计文档 13.1）：顶栏货币、关卡条、上半屏自动战斗、右上悬浮按钮、
 * 上阵阵位与一键升级、底部 5 个页签；离线收益、签到、进山结果、概率说明弹窗。
 * 全部由代码搭建，图片按名字从 Skin 取，缺图时显示占位。
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
  private ticketL!: Label;
  private powerL!: Label;
  private stageL!: Label;
  private stageMidL!: Label;
  private stageR!: Label;
  private signinBtn!: { node: Node; dot: Node };
  private wildBtn!: { node: Node; dot: Node; title: Label };
  private team!: Node;
  private teamSig = '';
  private upgradeBtn!: SkinButton;
  private infoL!: Label;
  private pageRoot!: Node;
  private pages: Partial<Record<TabKey, Page>> = {};
  private tabIcons: Partial<Record<TabKey, Node>> = {};
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

    // 上半屏战斗
    const battleTop = top - 170;
    BattleView.create(this.node, W, 580, 0, battleTop - 290, {
      onCleared: (stage) => this.onCleared(stage),
      toast: (t) => this.toast(t),
    });

    // 右上悬浮按钮（在战斗区的天空里）
    this.signinBtn = iconButton(this.node, 'icon_signin', 86, '签到', () => this.showSignin(), W / 2 - 58, battleTop - 66);
    iconButton(this.node, 'icon_chest', 86, '宝箱', () => this.toast('宝箱即将开放'), W / 2 - 158, battleTop - 66);
    this.wildBtn = iconButton(this.node, 'icon_wild', 86, '野遇', () => this.claimWild(), W / 2 - 258, battleTop - 66);
    this.wildBtn.node.active = false;

    // 上阵阵位
    const teamY = top - 870;
    makeSprite(this.node, 'panel_paper', W - 30, 214, 0, teamY, { fallback: '#fff8ea' });
    const tag = makeSprite(this.node, 'pill', 150, 46, -W / 2 + 110, teamY + 104, { fallback: '#fffaf0' });
    makeLabel(tag, '上阵异兽', 22, OL);
    this.team = uiNode('Team', this.node, 0, teamY);
    this.team.on(Node.EventType.TOUCH_END, () => this.switchTab('beasts'));
    const tut = this.team.addComponent(UITransform);
    tut.setContentSize(W - 40, 200);

    // 一键升级 / 上阵最强
    const upY = top - 1030;
    this.upgradeBtn = skinButton(this.node, 'btn_red', '一键升级', 430, 112, () => this.onUpgrade(), -W / 2 + 245, upY, '');
    skinButton(this.node, 'btn_ink', '上阵最强', 240, 104, () => {
      App.core.autoTeam();
      App.save();
      this.toast('已上阵最强阵容');
    }, W / 2 - 145, upY);
    this.infoL = makeLabel(this.node, '', 22, '#8a6d55', 0, top - 1108);

    // 页签页面（盖在战斗区和阵位上）
    this.pageRoot = uiNode('Pages', this.node);

    // 顶栏与关卡条
    this.goldL = currencyPill(this.node, 'icon_gold', -W / 2 + 135, top - 52, 230);
    this.ticketL = currencyPill(this.node, 'icon_ticket', -20, top - 52, 180);
    this.powerL = currencyPill(this.node, 'icon_power', W / 2 - 135, top - 52, 230);
    const bar = makeSprite(this.node, 'pill', W - 50, 60, 0, top - 128, { fallback: '#fffaf0' });
    this.stageL = alignedLabel(bar, '', 26, OL, -(W - 50) / 2 + 28, 0, 'left');
    this.stageMidL = makeLabel(bar, '', 22, '#ff5a5a', 20, 0);
    this.stageR = alignedLabel(bar, '', 24, OL, (W - 50) / 2 - 28, 0, 'right');

    // 底部页签
    makeSprite(this.node, 'tab_bar', W, 170, 0, bottom + 85, { fallback: '#fffaf0' });
    TABS.forEach((t, i) => {
      const x = (i - 2) * (W / 5);
      const icon = makeSprite(this.node, `tab_${t.key}_off`, 100, 100, x, bottom + 104, { fallback: '#d9cfc2' });
      icon.on(Node.EventType.TOUCH_END, () => this.switchTab(t.key));
      makeLabel(this.node, t.name, 24, OL, x, bottom + 34);
      this.tabIcons[t.key] = icon;
    });
    this.switchTab('battle');

    App.core.events.on('offline', () => this.maybeShowOffline());
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
    setLabel(this.ticketL, String(s.tickets));
    setLabel(this.powerL, formatNumber(core.teamPower()));
    const ch = App.cfg.stages.chapters[core.f.chapterOfStage(s.stage + 1) - 1] || App.cfg.stages.chapters[App.cfg.stages.chapters.length - 1];
    const next = core.nextStage();
    setLabel(this.stageL, `${ch.name.split('·')[0]} · 第 ${Math.max(1, s.stage + (next ? 1 : 0))} 关`);
    setLabel(this.stageMidL, !next ? '主线已通关' : next.isChapterBoss ? `下一关：${ch.boss.name}` : next.isSmallBoss ? '下一关：小 Boss' : '');
    setLabel(this.stageR, `挂机 +${formatNumber(core.goldPerMin())}/分`);
    if (core.fillEmptySlots()) App.save();
    this.signinBtn.dot.active = core.canClaimSignin();
    this.wildBtn.node.active = s.wildStore > 0;
    this.refreshTeam();
    this.refreshUpgrade();
    const page = this.pages[this.current];
    if (page) page.refresh();
    this.maybeShowOffline();
    if (!this.popupOpen && !this.signinAutoShown && core.canClaimSignin() && !s.pendingOffline) {
      this.signinAutoShown = true;
      this.showSignin();
    }
  }

  // ------------------------------------------------------------ 阵位与升级

  private refreshTeam(): void {
    const core = App.core;
    const s = core.state;
    const k = core.slotsAvailable();
    const sig = s.team.join(',') + '|' + s.slotLevels.join(',') + '|' + k + '|' + Object.keys(s.beasts).map((id) => s.beasts[id].star).join('');
    if (sig === this.teamSig) return;
    this.teamSig = sig;
    for (const c of this.team.children.slice()) c.destroy();
    const unlocks = App.cfg.progression.slot.unlocks;
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
      if (id && s.beasts[id]) makeBeastIcon(this.team, id, 108, x, 18, {});
      else makeLabel(this.team, '空', 30, '#a08a76', x, 18);
      makeLabel(this.team, `Lv.${s.slotLevels[i]}`, 24, OL, x, -62);
    }
  }

  private cheapestCost(): number {
    const core = App.core;
    const k = core.slotsAvailable();
    let lv = Infinity;
    for (let i = 0; i < k; i++) lv = Math.min(lv, core.state.slotLevels[i]);
    return core.f.slotCost(lv);
  }

  private refreshUpgrade(): void {
    const cost = this.cheapestCost();
    const ok = App.core.state.gold >= cost;
    this.upgradeBtn.setText('一键升级', `需 ${formatNumber(cost)} 金币`);
    this.upgradeBtn.setEnabled(ok);
    setLabel(this.infoL, ok ? '金币够了，点「一键升级」变强！' : '离线也在打 · 最多累计 8 小时');
  }

  private onUpgrade(): void {
    const n = App.core.upgradeCheapest();
    if (n <= 0) {
      this.toast('金币不够，挂机攒一会吧');
      return;
    }
    App.analytics.track('slot_level_up', { levels: n });
    App.save();
    floatText(this.node, `阵位 +${n} 级`, -this.W / 2 + 245, this.H / 2 - 960, 32, '#ff5a5a', 0.9, 50);
    this.teamSig = '';
  }

  private onCleared(stage: number): void {
    if (stage === 10 || stage === 40) this.toast(`第 ${stage} 关通关！开放新的阵位`);
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
    toast(this.node, text, this.H / 2 - 260);
  }

  doPull(mountainId: string, count: number): void {
    const res = App.core.pull(mountainId, count);
    if (!res.ok) {
      this.toast(res.reason === 'tickets' ? '进山符不够了，看视频可以领' : '这座山还没开放');
      return;
    }
    App.analytics.track('pull', { mountain: mountainId, count, free: count === 10 && res.results.length === 10 });
    App.save();
    this.showPullResults(res.results);
  }

  showRates(): void {
    const pop = popup(this.node, '概率说明', 680, 900);
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
    const pop = popup(this.node, results.length >= 10 ? '十连收获' : '进山收获', 680, results.length >= 10 ? 640 : 460);
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

  private maybeShowOffline(): void {
    const p = App.core.state.pendingOffline;
    if (!p || this.popupOpen) return;
    this.popupOpen = true;
    const mult = App.ads.countToday('offline_double') === 0 ? 3 : 2;
    const claim = (m: number) => {
      const got = App.core.claimOffline(m);
      App.analytics.track('offline_claim', { minutes: Math.round(p.ms / 60000), mult: m });
      App.save();
      if (got > 0) this.toast(`领取 ${formatNumber(got)} 金币`);
    };
    const pop = popup(this.node, '离线收益', 600, 540, () => {
      this.popupOpen = false;
      if (App.core.state.pendingOffline) claim(1);
    });
    makeLabel(pop.body, `你离开了 ${formatDuration(p.ms)}\n异兽们一直在帮你打怪`, 28, OL, 0, 120);
    makeSprite(pop.body, 'icon_gold', 96, 96, -120, 20, { fallback: '#ffd84d' });
    alignedLabel(pop.body, `+${formatNumber(p.gold)}`, 52, '#e8a317', -60, 20, 'left');
    skinButton(pop.body, 'btn_ink', '领取', 220, 96, () => {
      claim(1);
      pop.close();
    }, -135, -120);
    const ad = skinButton(pop.body, 'btn_gold', `看视频 ×${mult}`, 260, 96, async () => {
      const r = await App.ads.showRewarded('offline_double');
      if (!r.granted) {
        this.toast('没有看完视频，按原数量领取');
        claim(1);
      } else claim(1 + (mult - 1) * r.ratio);
      pop.close();
    }, 125, -120);
    if (App.ads.available('offline_double')) App.ads.markOffered('offline_double');
    else ad.setEnabled(false);
  }

  private showSignin(): void {
    if (this.popupOpen) return;
    this.popupOpen = true;
    const core = App.core;
    const cfg = App.cfg.signin;
    const st = core.state.signin;
    const list = st.round === 0 ? cfg.firstRound : cfg.laterRounds;
    const can = core.canClaimSignin();
    const pop = popup(this.node, st.round === 0 ? '七日签到' : '每日签到', 690, 860, () => {
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
      if (!res) return;
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
  if (r.tickets) parts.push(`进山符×${r.tickets}`);
  if (r.wild) for (const k in r.wild) parts.push(`万能星魄×${r.wild[k as 'ling']}`);
  if (r.goldMinutes) parts.push(`金币\n(${r.goldMinutes}分钟)`);
  return parts.join('\n');
}
