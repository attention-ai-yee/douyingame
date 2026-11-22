import { _decorator, Component, Graphics, Label, Node, UIOpacity, UITransform } from 'cc';
import { App } from '../../app/App';
import { ChallengeResult, formatNumber } from '../../core';
import { BeastIcon, makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { floatText } from '../ui/Widgets';
import { BattleSim, HitEvent } from './BattleSim';

const { ccclass } = _decorator;

/** 战斗区域内的站位（以战斗区域中心为原点）。前排 2 个、后排 3 个。 */
const ALLY_POS: [number, number][] = [
  [-115, -10],
  [-115, -165],
  [-255, 60],
  [-255, -90],
  [-255, -235],
];
const UNIT = 104;
const HP_W = 100;

interface UnitView {
  root: Node;
  icon: BeastIcon;
  hpFill: Node;
  baseX: number;
  baseY: number;
  dir: number;
  lunge: number;
  flash: number;
  dead: boolean;
  scale: number;
}

export type BattleMode =
  /** 首页挂机：一波接一波打小怪，永远是赢，打倒的小怪掉落飞进宝箱。不推关。 */
  | { kind: 'idle' }
  /** 进山闯关：打指定的下一关（或镇妖塔下一层）一场，打完由 core 判定胜负。 */
  | { kind: 'stage' }
  | { kind: 'tower' };

/** 站位布局：单位放大倍数、整体偏移；hideBanner 时不显示左上角的关卡名（首页有自己的横幅）。 */
export interface BattleLayout {
  /** 单位大小倍数。 */
  scale: number;
  /** 站位间距倍数（横向、纵向）。 */
  spreadX: number;
  spreadY: number;
  offsetX: number;
  offsetY: number;
  hideBanner?: boolean;
  /** 自定义我方站位（敌人左右镜像）；不填用默认的前 2 后 3。 */
  positions?: [number, number][];
}

export interface BattleHost {
  /** 挂机时打倒一只小怪（x、y 为战斗区域内坐标），用来播放掉落飞进宝箱。 */
  onLoot?(x: number, y: number): void;
  /** 闯关打完一场。 */
  onResult?(res: ChallengeResult): void;
}

/**
 * 横版自动战斗演出（结果由 core 按战力判定，这里只负责表现）。
 * - idle：首页挂机，小怪按当前地图生成，强度远低于我方，永远打得过；
 * - stage / tower：进山里点"挑战"后打一场，结束时调用 core.challengeStage / challengeFloor。
 */
@ccclass('BattleView')
export class BattleView extends Component {
  static create(parent: Node, w: number, h: number, x: number, y: number, mode: BattleMode, host: BattleHost, layout?: BattleLayout): BattleView {
    const n = uiNode('Battle', parent, x, y);
    const v = n.addComponent(BattleView);
    if (layout) v.layout = layout;
    v.setup(w, h, mode, host);
    return v;
  }

  private layout: BattleLayout = { scale: 1, spreadX: 1, spreadY: 1, offsetX: 0, offsetY: 0 };

  private host!: BattleHost;
  private mode: BattleMode = { kind: 'idle' };
  private w = 750;
  private h = 580;
  private bg!: Node;
  private bgName = '';
  private unitsRoot!: Node;
  private fxRoot!: Node;
  private allies: UnitView[] = [];
  private enemies: UnitView[] = [];
  private sim: BattleSim | null = null;
  private assist = false;
  private cooldown = 0.5;
  private finished = false;
  private wave = 0;
  private banner!: Label;

  private setup(w: number, h: number, mode: BattleMode, host: BattleHost): void {
    this.host = host;
    this.mode = mode;
    this.w = w;
    this.h = h;
    this.bg = uiNode('Bg', this.node);
    this.unitsRoot = uiNode('Units', this.node);
    this.fxRoot = uiNode('Fx', this.node);
    const bannerBg = makeSprite(this.node, 'pill', 300, 52, -w / 2 + 170, h / 2 - 50, { fallback: '#fffaf0', alpha: 230 });
    this.banner = makeLabel(bannerBg, '', 24, '#4a2f27', 0, 0);
    bannerBg.active = !this.layout.hideBanner;
    const ut = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
    ut.setContentSize(w, h);
  }

  /** 闯关模式：开打（useAssist 为 true 表示已看完助战广告）。 */
  startChallenge(useAssist = false): void {
    this.assist = useAssist;
    this.finished = false;
    this.cooldown = 0;
    this.sim = null;
    this.startFight();
  }

  get fighting(): boolean {
    return !!this.sim;
  }

  // ------------------------------------------------------------ 每帧

  update(dt: number): void {
    if (!App.ready) return;
    this.refreshBackground();
    if (!this.sim) {
      if (this.mode.kind === 'idle') {
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.startFight();
      }
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

  /** 当前所在地图（挂机用的是已通关的最远地图）。 */
  private chapterNow(): number {
    const core = App.core;
    const n = this.mode.kind === 'stage' ? core.state.stage + 1 : Math.max(1, core.state.stage);
    return Math.min(core.f.chapterOfStage(n), App.cfg.stages.chapters.length);
  }

  private startFight(): void {
    const core = App.core;
    const team = this.teamIds();
    const myPower = core.teamPower() * (this.assist ? App.cfg.progression.assist.powerMult : 1);
    let enemyPower: number;
    let enemyIds: string[];
    let boss = false;
    let win = true;
    let title: string;
    if (this.mode.kind === 'idle') {
      this.wave++;
      const stage = Math.max(1, core.state.stage);
      enemyIds = this.mobIds(stage, this.wave);
      enemyPower = Math.max(1, myPower * 0.35);
      const ch = App.cfg.stages.chapters[this.chapterNow() - 1];
      title = `${ch.name.split('·')[0]} · 挂机中`;
    } else if (this.mode.kind === 'stage') {
      const next = core.nextStage();
      if (!next) return;
      enemyPower = next.enemyPower;
      boss = next.isSmallBoss || next.isChapterBoss;
      enemyIds = this.stageEnemyIds(next.stage, next.isChapterBoss, next.isSmallBoss);
      win = myPower >= enemyPower;
      const ch = App.cfg.stages.chapters[next.chapter - 1];
      title = `${ch.name.split('·')[0]} · 第 ${next.stage - (next.chapter - 1) * App.cfg.stages.chapterLength} 关`;
    } else {
      const f = core.state.floor + 1;
      enemyPower = core.nextFloorPower();
      boss = core.f.isTowerBoss(f);
      enemyIds = this.stageEnemyIds(40 + f, false, boss);
      win = myPower >= enemyPower;
      title = `镇妖塔 · 第 ${f} 层`;
    }
    const unitPowers = team.map((id) => core.unitPower(id));
    const total = unitPowers.reduce((a, b) => a + b, 0) || 1;
    const allyPowers = unitPowers.map((p) => (myPower * p) / total);
    // 演出用的随机数不消耗 core 的随机序列
    this.sim = new BattleSim({ allyPowers, enemyCount: enemyIds.length, enemyPower, win, rng: Math.random });
    this.buildUnits(team, enemyIds, boss);
    setLabel(this.banner, title);
  }

  private finishFight(): void {
    this.sim = null;
    this.cooldown = 0.6;
    if (this.mode.kind === 'idle' || this.finished) return;
    this.finished = true;
    const core = App.core;
    const res = this.mode.kind === 'stage' ? core.challengeStage(this.assist) : core.challengeFloor(this.assist);
    if (this.host.onResult) this.host.onResult(res);
  }

  // ------------------------------------------------------------ 单位

  private teamIds(): string[] {
    const ids = App.core.teamIds();
    return ids.length ? ids : Object.keys(App.core.state.beasts).slice(0, 1);
  }

  /** 挂机小怪：当前地图的凡/灵兽，每波 2～3 只。 */
  private mobIds(stage: number, wave: number): string[] {
    const m = App.core.idx.mountainOfChapter[this.chapterNow()];
    const pool = m.tiers.fan.map((x) => x[0]).concat(m.tiers.ling.map((x) => x[0]));
    const count = 2 + (wave % 2);
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(pool[(stage + wave * 5 + i * 3) % pool.length]);
    return out;
  }

  /** 关卡敌人：小怪用当前章节山里的凡/灵兽；Boss 关用对应的稀有兽或章节 Boss。 */
  private stageEnemyIds(stage: number, chapterBoss: boolean, smallBoss: boolean): string[] {
    const ch = Math.min(App.core.f.chapterOfStage(stage), App.cfg.stages.chapters.length);
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
    const L = this.layout;
    const P = L.positions || ALLY_POS;
    const px = (x: number) => x * L.spreadX + L.offsetX;
    const py = (y: number) => y * L.spreadY + L.offsetY;
    this.allies = team.map((id, i) => this.makeUnit(id, px(P[i][0]), py(P[i][1]), 1, false, L.scale));
    this.enemies = enemyIds.map((id, i) => {
      if (boss && i === 0) return this.makeUnit(id, px(150), py(-40), -1, true, (enemyIds.length === 1 ? 1.7 : 1.4) * L.scale);
      const pos = P[boss ? i + 1 : i];
      return this.makeUnit(id, px(-pos[0]), py(pos[1]), -1, true, L.scale);
    });
  }

  private makeUnit(beastId: string, x: number, y: number, dir: number, enemy: boolean, scale: number): UnitView {
    const root = uiNode('Unit', this.unitsRoot, x, y);
    root.setScale(scale, scale, 1);
    const icon = makeBeastIcon(root, beastId, UNIT * 1.25, 0, 6, { frame: null, enemy });
    // 我方朝右、敌人朝左；立绘本身朝左的要反过来
    const artLeft = App.core.idx.beast[beastId].facing === 'left';
    if (Skin.has(`beast_${beastId}`) && enemy !== artLeft) icon.portrait.setScale(-1, 1, 1);
    makeSprite(root, 'hp_bg', HP_W, 20, 0, -UNIT / 2 - 20, { fallback: '#ffffff' });
    const hpFill = makeSprite(root, enemy ? 'hp_red' : 'hp_green', HP_W - 8, 12, -(HP_W - 8) / 2, -UNIT / 2 - 20, { fallback: enemy ? '#ff5a5a' : '#3fcf7f' });
    const ut = hpFill.getComponent(UITransform);
    if (ut) ut.setAnchorPoint(0, 0.5);
    if (!enemy) {
      const b = App.core.state.beasts[beastId];
      if (b) makeLabel(root, `Lv.${b.level}`, 20, '#ffffff', 0, UNIT / 2 + 14);
    }
    return { root, icon, hpFill, baseX: x, baseY: y, dir, lunge: 0, flash: 0, dead: false, scale };
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
      floatText(this.fxRoot, txt, p.x + (Math.random() * 30 - 15), p.y + 50 * this.layout.scale, e.crit ? 34 : 28, e.crit ? '#ff6d00' : '#fff4d6', 0.7, 55);
      if (e.killed && this.mode.kind === 'idle' && this.host.onLoot) this.host.onLoot(p.x, p.y);
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
        if (ut) ut.setContentSize(Math.max(0.001, (HP_W - 8) * frac), 12);
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
      u.icon.tint(u.flash > 0 ? '#ff8a80' : 'normal');
      if (u.dead) {
        const op = u.root.getComponent(UIOpacity) || u.root.addComponent(UIOpacity);
        op.opacity = Math.max(this.mode.kind === 'idle' ? 0 : 60, op.opacity - Math.round(dt * 600));
      }
    }
  }

  private refreshBackground(): void {
    const m = App.core.idx.mountainOfChapter[this.chapterNow()];
    const mid = m ? m.id : 'nanshan';
    // 首页挂机用更高的背景（tools/art/home_bg.py 生成），没有就用战斗背景
    let name = this.mode.kind === 'tower' ? 'bg_battle_beidongzhong' : `bg_battle_${mid}`;
    if (this.mode.kind === 'idle' && Skin.has(`bg_home_${mid}`)) name = `bg_home_${mid}`;
    if (name === this.bgName) return;
    this.bgName = name;
    if (Skin.has(name)) {
      setSprite(this.bg, name, this.w, this.h);
      return;
    }
    // 背景图还没到：蓝天 + 草地占位
    const g = this.bg.getComponent(Graphics) || this.bg.addComponent(Graphics);
    g.clear();
    g.fillColor = hex('#bfe6ff');
    g.rect(-this.w / 2, -this.h / 2, this.w, this.h);
    g.fill();
    g.fillColor = hex('#c9eba0');
    g.rect(-this.w / 2, -this.h / 2, this.w, this.h * 0.42);
    g.fill();
  }
}
