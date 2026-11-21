import { _decorator, Component, Label, Node, UIOpacity, UITransform } from 'cc';
import { App } from '../../app/App';
import { formatNumber, Rarity } from '../../core';
import { makeSprite, setSprite, setSpriteColor } from '../ui/Skin';
import { makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { floatText, skinButton, SkinButton } from '../ui/Widgets';
import { BattleSim, HitEvent } from './BattleSim';

const { ccclass } = _decorator;

/** 战斗区域内的站位（以战斗区域中心为原点）。前排 2 个、后排 3 个。 */
const ALLY_POS: [number, number][] = [
  [-115, 10],
  [-115, -150],
  [-255, 90],
  [-255, -70],
  [-255, -225],
];
const UNIT = 104;
const HP_W = 100;

interface UnitView {
  root: Node;
  portrait: Node;
  hpFill: Node;
  baseX: number;
  baseY: number;
  dir: number;
  lunge: number;
  flash: number;
  dead: boolean;
  scale: number;
}

export interface BattleHost {
  /** 推进成功（首通），用来刷新顶栏、提示奖励。 */
  onCleared(stage: number, gold: number, tickets: number): void;
  toast(text: string): void;
}

/**
 * 主界面上半屏的自动战斗演出。
 * - 推图模式：打下一关，赢了自动继续；遇到 Boss 关停下来，等玩家点"挑战 Boss"。
 * - 挂机模式：重复打已通关的关卡（只是演出，金币按时间在 core 里结算）；战力够了自动回到推图。
 * - 输了弹出失败面板：召唤助战（看视频）、去升级、继续挂机。
 */
@ccclass('BattleView')
export class BattleView extends Component {
  static create(parent: Node, w: number, h: number, x: number, y: number, host: BattleHost): BattleView {
    const n = uiNode('Battle', parent, x, y);
    const v = n.addComponent(BattleView);
    v.setup(w, h, host);
    return v;
  }

  private host!: BattleHost;
  private w = 750;
  private h = 580;
  private bg!: Node;
  private bgName = '';
  private unitsRoot!: Node;
  private fxRoot!: Node;
  private allies: UnitView[] = [];
  private enemies: UnitView[] = [];
  private sim: BattleSim | null = null;
  private mode: 'push' | 'farm' = 'push';
  private fightIsPush = false;
  private fightAssist = false;
  private bossRequested = false;
  private cooldown = 0.6;
  private bossBtn!: SkinButton;
  private failPanel: Node | null = null;
  private banner!: Label;

  private setup(w: number, h: number, host: BattleHost): void {
    this.host = host;
    this.w = w;
    this.h = h;
    this.bg = makeSprite(this.node, 'bg_battle_nanshan', w, h, 0, 0, { fallback: '#cfc6ae' });
    this.unitsRoot = uiNode('Units', this.node);
    this.fxRoot = uiNode('Fx', this.node);
    this.banner = makeLabel(this.node, '', 34, '#3b2a12', 0, h / 2 - 60);
    this.bossBtn = skinButton(this.node, 'btn_red', '挑战 Boss', 300, 92, () => this.requestBoss(), 0, -h / 2 + 58);
    this.bossBtn.node.active = false;
    // 战斗区域本身吃掉点击，避免误触到下面
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(w, h);
  }

  // ------------------------------------------------------------ 每帧

  update(dt: number): void {
    if (!App.ready) return;
    this.refreshBackground();
    if (this.failPanel) return;
    if (!this.sim) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.startFight();
      this.animateUnits(dt);
      return;
    }
    const events = this.sim.step(Math.min(dt, 0.1) * 1000);
    for (const e of events) this.playHit(e);
    this.syncHp();
    this.animateUnits(dt);
    if (this.sim.done) this.finishFight();
  }

  // ------------------------------------------------------------ 开打 / 结算

  private startFight(useAssist = false): void {
    const core = App.core;
    const next = core.nextStage();
    if (this.mode === 'push' && next && (next.isSmallBoss || next.isChapterBoss) && !this.bossRequested) this.mode = 'farm';
    const push = this.mode === 'push' && !!next;
    const stage = push && next ? next.stage : Math.max(1, core.state.stage);
    const enemyPower = core.f.enemyPower(stage);
    const mult = useAssist ? App.cfg.progression.assist.powerMult : 1;
    const power = core.teamPower() * mult;
    const win = push ? power >= enemyPower : true;
    this.fightIsPush = push;
    this.fightAssist = useAssist;

    const team = this.teamIds();
    const totalUnitPower = team.reduce((a, id) => a + core.f.unitPower(id, core.state.beasts[id].star, core.state.beasts[id].awaken, core.state.beasts[id].shiny), 0) || 1;
    const allyPowers = team.map((id) => {
      const b = core.state.beasts[id];
      return (power * core.f.unitPower(id, b.star, b.awaken, b.shiny)) / totalUnitPower;
    });
    const isChapterBoss = core.f.isChapterBoss(stage);
    const isSmallBoss = core.f.isSmallBoss(stage);
    const enemyIds = this.enemyIds(stage, isChapterBoss, isSmallBoss);
    // 演出用的随机数不消耗 core 的随机序列
    this.sim = new BattleSim({ allyPowers, enemyCount: enemyIds.length, enemyPower, win, rng: Math.random });
    this.buildUnits(team, enemyIds, isChapterBoss || isSmallBoss);
    const ch = App.cfg.stages.chapters[core.f.chapterOfStage(stage) - 1];
    const title = isChapterBoss ? `第 ${stage} 关 · ${ch.boss.name}` : isSmallBoss ? `第 ${stage} 关 · 小 Boss` : `第 ${stage} 关`;
    setLabel(this.banner, push ? title : `${title}（挂机中）`);
    App.analytics.track('stage_start', { stage, push, power: Math.round(power), enemyPower: Math.round(enemyPower), assist: useAssist });
  }

  private finishFight(): void {
    const sim = this.sim as BattleSim;
    this.sim = null;
    this.cooldown = 0.7;
    const core = App.core;
    if (!this.fightIsPush) {
      // 挂机打完一场：如果下一关不是 Boss 且战力够了，自动回到推图
      const next = core.nextStage();
      if (next && !next.isSmallBoss && !next.isChapterBoss && core.teamPower() >= next.enemyPower) this.mode = 'push';
      this.bossBtn.node.active = !!next && (next.isSmallBoss || next.isChapterBoss) && this.mode === 'farm';
      return;
    }
    const before = core.state.stage;
    const res = core.challengeStage(this.fightAssist);
    if (res.win) {
      this.bossRequested = false;
      this.mode = 'push';
      this.bossBtn.node.active = false;
      const gold = App.core.f.goldPerMin(core.state.stage) * App.cfg.progression.gold.firstClearMinutes;
      floatText(this.fxRoot, `通关！+${formatNumber(gold)} 金币`, 0, 40, 36, '#b3261e', 1.2, 50);
      this.host.onCleared(core.state.stage, gold, 0);
      App.analytics.track('stage_win', { stage: core.state.stage, power: Math.round(res.power), enemyPower: Math.round(res.enemyPower) });
      App.save();
    } else {
      App.analytics.track('stage_fail', { stage: before + 1, power: Math.round(res.power), enemyPower: Math.round(res.enemyPower), simWin: sim.win });
      this.mode = 'farm';
      this.bossRequested = false;
      this.showFail(res.power, res.enemyPower);
    }
  }

  private requestBoss(): void {
    this.bossRequested = true;
    this.mode = 'push';
    this.bossBtn.node.active = false;
    this.sim = null;
    this.cooldown = 0.2;
  }

  // ------------------------------------------------------------ 失败面板

  private showFail(power: number, enemy: number): void {
    const p = makeSprite(this.node, 'panel_ink', 600, 330, 0, -20, { fallback: '#17191e', alpha: 240 });
    this.failPanel = p;
    makeLabel(p, '挑战失败', 44, '#ff8a65', 0, 112);
    makeLabel(p, `我方战力 ${formatNumber(power)}　敌方 ${formatNumber(enemy)}`, 26, '#f3e6c8', 0, 56);
    const ads = App.ads;
    const left = ads.remaining('assist');
    const canAssist = ads.available('assist');
    const b1 = skinButton(p, 'btn_gold', '召唤助战', 250, 96, () => this.onAssist(), -140, -30, `看视频 · 战力×${App.cfg.progression.assist.powerMult}`);
    b1.setEnabled(canAssist);
    if (canAssist) ads.markOffered('assist');
    skinButton(p, 'btn_ink', '去升级', 250, 96, () => this.closeFail('去下方点「一键升级」变强吧'), 140, -30);
    skinButton(p, 'btn_ink', '先挂机攒一会', 520, 72, () => this.closeFail(''), 0, -128);
    makeLabel(p, left === null ? '' : `今日助战剩余 ${left} 次`, 20, '#9aa3b2', -140, -88);
  }

  private closeFail(msg: string): void {
    if (this.failPanel) this.failPanel.destroy();
    this.failPanel = null;
    if (msg) this.host.toast(msg);
  }

  private async onAssist(): Promise<void> {
    const r = await App.ads.showRewarded('assist');
    if (!r.granted) {
      this.host.toast(r.status === 'skipped' ? '没有看完视频，不能召唤助战' : '暂时没有广告，稍后再试');
      return;
    }
    this.closeFail('');
    this.bossRequested = true;
    this.mode = 'push';
    this.sim = null;
    this.startFight(true);
  }

  // ------------------------------------------------------------ 单位

  private teamIds(): string[] {
    const core = App.core;
    const k = core.slotsAvailable();
    const out: string[] = [];
    for (let i = 0; i < k; i++) {
      const id = core.state.team[i];
      if (id && core.state.beasts[id]) out.push(id);
    }
    return out.length ? out : Object.keys(core.state.beasts).slice(0, 1);
  }

  /** 敌人：用当前章节山里的凡/灵兽换色当小怪；Boss 关用对应的稀有兽或章节 Boss。 */
  private enemyIds(stage: number, chapterBoss: boolean, smallBoss: boolean): string[] {
    const ch = App.core.f.chapterOfStage(stage);
    const m = App.core.idx.mountainOfChapter[ch];
    const fan = m.tiers.fan.map((x) => x[0]);
    const ling = m.tiers.ling.map((x) => x[0]);
    const pick = (list: string[], k: number) => list[(stage * 7 + k * 3) % list.length];
    if (chapterBoss) {
      const cb = App.cfg.stages.chapters[ch - 1].boss;
      return [cb.captureBeast || pick(fan, 0)];
    }
    if (smallBoss) return [pick(m.tiers.xi.map((x) => x[0]), 0), pick(fan, 1), pick(fan, 2)];
    const count = stage <= 3 ? 1 : stage % 3 === 0 ? 3 : 2;
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(i === 0 && stage % 4 === 0 ? pick(ling, i) : pick(fan, i));
    return out;
  }

  private buildUnits(team: string[], enemyIds: string[], boss: boolean): void {
    for (const u of this.allies.concat(this.enemies)) u.root.destroy();
    this.allies = team.map((id, i) => this.makeUnit(id, ALLY_POS[i][0], ALLY_POS[i][1], 1, false, 1));
    this.enemies = enemyIds.map((id, i) => {
      if (boss && i === 0) return this.makeUnit(id, 150, -40, -1, true, enemyIds.length === 1 ? 1.7 : 1.4);
      const pos = ALLY_POS[boss ? i + 1 : i];
      return this.makeUnit(id, -pos[0], pos[1], -1, true, 1);
    });
  }

  private makeUnit(beastId: string, x: number, y: number, dir: number, enemy: boolean, scale: number): UnitView {
    const def = App.core.idx.beast[beastId];
    const root = uiNode('Unit', this.unitsRoot, x, y);
    root.setScale(scale, scale, 1);
    const portrait = makeSprite(root, `beast_${beastId}`, UNIT, UNIT, 0, 0, { fallback: '#8a7a5a', color: enemy ? '#8c7a96' : undefined });
    const rarity: Rarity = enemy ? 'fan' : def.rarity;
    makeSprite(root, `frame_${rarity}`, UNIT * 1.2, UNIT * 1.2, 0, 0, { optional: true, color: enemy ? '#c0392b' : undefined });
    makeSprite(root, 'hp_bg', HP_W, 16, 0, -UNIT / 2 - 22, { fallback: '#111111' });
    const hpFill = makeSprite(root, enemy ? 'hp_red' : 'hp_green', HP_W - 4, 12, -(HP_W - 4) / 2, -UNIT / 2 - 22, { fallback: enemy ? '#c0392b' : '#2e9e62' });
    const ut = hpFill.getComponent(UITransform);
    if (ut) ut.setAnchorPoint(0, 0.5);
    makeLabel(root, def.name, 20, enemy ? '#7f1a14' : '#1f1b16', 0, UNIT / 2 + 14);
    return { root, portrait, hpFill, baseX: x, baseY: y, dir, lunge: 0, flash: 0, dead: false, scale };
  }

  private playHit(e: HitEvent): void {
    const from = e.side === 'ally' ? this.allies[e.from] : this.enemies[e.from];
    const to = e.side === 'ally' ? this.enemies[e.to] : this.allies[e.to];
    if (!from || !to) return;
    from.lunge = 0.18;
    to.flash = 0.15;
    const p = to.root.position;
    if (e.side === 'ally') {
      const txt = e.crit ? `暴击 ${formatNumber(e.dmg)}` : formatNumber(e.dmg);
      floatText(this.fxRoot, txt, p.x + (Math.random() * 30 - 15), p.y + 50, e.crit ? 34 : 28, e.crit ? '#ff6d00' : '#fff4d6', 0.7, 55);
    } else {
      floatText(this.fxRoot, `-${formatNumber(e.dmg)}`, p.x, p.y + 40, 22, '#e53935', 0.6, 40);
    }
    if (e.killed) to.dead = true;
  }

  private syncHp(): void {
    const sim = this.sim;
    if (!sim) return;
    const set = (views: UnitView[], units: { hp: number; maxHp: number }[]) => {
      for (let i = 0; i < views.length; i++) {
        const frac = units[i] ? Math.max(0, units[i].hp / units[i].maxHp) : 0;
        const ut = views[i].hpFill.getComponent(UITransform);
        if (ut) ut.setContentSize(Math.max(0.001, (HP_W - 4) * frac), 12);
      }
    };
    set(this.allies, sim.allies);
    set(this.enemies, sim.enemies);
  }

  private animateUnits(dt: number): void {
    for (const u of this.allies.concat(this.enemies)) {
      u.lunge = Math.max(0, u.lunge - dt);
      u.flash = Math.max(0, u.flash - dt);
      const k = u.lunge > 0 ? Math.sin((1 - u.lunge / 0.18) * Math.PI) : 0;
      u.root.setPosition(u.baseX + u.dir * 30 * k, u.baseY);
      const enemyTint = u.dir < 0 ? '#8c7a96' : '#ffffff';
      setSpriteColor(u.portrait, u.flash > 0 ? '#ff8a80' : enemyTint, 255);
      if (u.dead) {
        const op = u.root.getComponent(UIOpacity) || u.root.addComponent(UIOpacity);
        op.opacity = Math.max(60, op.opacity - Math.round(dt * 600));
      }
    }
  }

  private refreshBackground(): void {
    const ch = App.core.f.chapterOfStage(App.core.state.stage + 1);
    const m = App.core.idx.mountainOfChapter[Math.min(ch, App.cfg.stages.chapters.length)];
    const name = `bg_battle_${m ? m.id : 'nanshan'}`;
    if (name !== this.bgName) {
      this.bgName = name;
      setSprite(this.bg, name, this.w, this.h, { fallback: '#cfc6ae' });
    }
  }
}
