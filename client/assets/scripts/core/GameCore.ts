import { ConfigIndex, indexConfig } from './config';
import { Emitter } from './events';
import { Formulas } from './formulas';
import { RevealSession } from './reveal/RevealSession';
import { Rng } from './rng';
import { createInitialState, Item, migrate, PlayerState } from './state';
import { DepthId, GameConfig, Rarity, RevealSource } from './types';
import * as collection from './systems/collection';
import { Ctx } from './systems/context';
import * as daily from './systems/daily';
import * as equipSys from './systems/equip';
import * as gacha from './systems/gacha';
import * as idle from './systems/idle';
import * as progression from './systems/progression';
import * as stage from './systems/stage';

export interface PendingReveal {
  id: number;
  beastId: string;
  rarity: Rarity;
  source: RevealSource;
  isBoss: boolean;
  shiny: boolean;
}

export interface RevealReward {
  seals: number;
  gold: number;
  exp: number;
  shards: number;
  /** 点睛成功变成闪光。 */
  dianjing: boolean;
}

export interface ChallengeResult {
  win: boolean;
  power: number;
  enemyPower: number;
}

export interface MountainStatus {
  id: string;
  name: string;
  chapter: number;
  depth: DepthId | null;
  unlocked: boolean;
}

export interface CoreEvents {
  stageCleared: { stage: number; reward: stage.StageReward };
  floorCleared: { floor: number; reward: stage.FloorReward };
  pulled: { mountainId: string; results: gacha.PullResult[] };
  revealQueued: PendingReveal;
  beastChanged: { beastId: string };
  teamChanged: (string | null)[];
  offline: idle.OfflineResult;
  chestClaimed: idle.ChestClaim;
  dailyReset: string;
}

/** 在线挂机超过这个间隔没有 tick（例如被系统挂起），按离线收益结算。 */
const MAX_ONLINE_GAP_MS = 2 * 60 * 1000;

/**
 * 游戏逻辑门面：持有配置、存档、随机数；view 层只通过它读写游戏状态。
 * 不依赖引擎和平台，时间通过 clock 注入（测试里可以用假时钟）。
 */
export class GameCore {
  readonly idx: ConfigIndex;
  readonly f: Formulas;
  readonly rng: Rng;
  readonly events = new Emitter<CoreEvents>();
  /** 等待现身拍符的异兽（已经入库，拍符只决定额外奖励）。 */
  readonly revealQueue: PendingReveal[] = [];
  state: PlayerState;
  private readonly clock: () => number;
  private lastTick: number;
  private revealSeq = 0;

  constructor(cfg: GameConfig, opts: { clock: () => number; state?: PlayerState | null; seed?: number }) {
    this.idx = indexConfig(cfg);
    this.f = new Formulas(this.idx);
    this.clock = opts.clock;
    const now = this.clock();
    this.state = opts.state || createInitialState(now, opts.seed === undefined ? 1 : opts.seed);
    this.rng = new Rng(this.state.rngState);
    this.lastTick = now;
  }

  /** 从存档字符串恢复；没有存档或存档损坏时新建。 */
  static loadState(raw: string | null, now: number, seed: number): PlayerState {
    if (raw) {
      try {
        const s = migrate(JSON.parse(raw), now, seed);
        if (s) return s;
      } catch (e) {
        // 存档损坏：落到下面新建
      }
    }
    return createInitialState(now, seed);
  }

  serialize(): string {
    this.state.rngState = this.rng.state;
    return JSON.stringify(this.state);
  }

  private ctx(now = this.clock()): Ctx {
    return { idx: this.idx, f: this.f, s: this.state, rng: this.rng, now };
  }

  // ------------------------------------------------------------ 生命周期

  /** 冷启动或回到前台时调用：跨天检查 + 把离线时间的挂机产出攒进宝箱。 */
  resume(): idle.OfflineResult {
    const ctx = this.ctx();
    if (daily.ensureDaily(ctx)) this.events.emit('dailyReset', this.state.daily.dayKey);
    const res = idle.computeOffline(ctx);
    this.lastTick = ctx.now;
    if (res.ms > 0 || res.clockRollback) this.events.emit('offline', res);
    return res;
  }

  /** 切到后台时调用：结算到当前时刻，记录最后在线时间。之后应立即存档。 */
  pause(): void {
    this.tick();
    this.state.lastActiveAt = this.clock();
  }

  /** 每帧或每秒调用：在线挂机往宝箱里攒、跨天重置。 */
  tick(): void {
    const ctx = this.ctx();
    const dt = ctx.now - this.lastTick;
    if (dt > MAX_ONLINE_GAP_MS || dt < 0) {
      this.state.lastActiveAt = this.lastTick;
      this.resume();
      return;
    }
    idle.accrueOnline(ctx, dt);
    this.lastTick = ctx.now;
    if (daily.ensureDaily(ctx)) this.events.emit('dailyReset', this.state.daily.dayKey);
  }

  // ------------------------------------------------------------ 查询

  teamPower(): number {
    return progression.teamPower(this.ctx());
  }

  goldPerMin(): number {
    return idle.idleGoldPerMin(this.ctx());
  }

  expPerMin(): number {
    return idle.idleExpPerMin(this.ctx());
  }

  unitPower(beastId: string): number {
    return progression.unitPowerOf(this.ctx(), beastId);
  }

  /** 上阵中的异兽（已开放的阵位）。 */
  teamIds(): string[] {
    return progression.teamIds(this.ctx());
  }

  idleEqStage(): number {
    return idle.idleEqStage(this.ctx());
  }

  /** 下一关能不能打过（进山页的红点、"可挑战"提示用）。 */
  canBeatNextStage(): boolean {
    const n = this.nextStage();
    return !!n && this.teamPower() >= n.enemyPower;
  }

  nextStage(): stage.StageInfo | null {
    return stage.nextStageInfo(this.ctx());
  }

  nextFloorPower(): number {
    return stage.nextFloorPower(this.ctx());
  }

  towerUnlocked(): boolean {
    return stage.towerUnlocked(this.ctx());
  }

  slotsAvailable(): number {
    return progression.slotsAvailable(this.ctx());
  }

  canFreeTenPull(): boolean {
    return this.state.daily.freeTenPullsUsed < this.idx.cfg.pools.dailyFreeTenPulls;
  }

  mountains(): MountainStatus[] {
    return this.idx.cfg.pools.mountains.map((m) => {
      const depth = this.f.depthOf(m.chapter, this.state.stage);
      return { id: m.id, name: m.name, chapter: m.chapter, depth, unlocked: depth !== null };
    });
  }

  rates(mountainId: string): Record<Rarity, number> | null {
    return gacha.currentRates(this.ctx(), mountainId);
  }

  // ------------------------------------------------------------ 寻兽（抽异兽）

  /**
   * 寻兽 count 次。十连优先用每日免费次数，否则扣进山符。
   * 稀有及以上会进入 revealQueue，view 依次弹出现身拍符。
   */
  pull(mountainId: string, count: number): { ok: boolean; reason?: 'locked' | 'tickets'; results: gacha.PullResult[] } {
    const ctx = this.ctx();
    if (!gacha.mountainDepth(ctx, mountainId)) return { ok: false, reason: 'locked', results: [] };
    const free = count === 10 && this.canFreeTenPull();
    if (!free && this.state.tickets < count) return { ok: false, reason: 'tickets', results: [] };
    if (free) this.state.daily.freeTenPullsUsed += 1;
    else this.state.tickets -= count;
    const results = gacha.pull(ctx, mountainId, count);
    for (const r of results) {
      if (r.needsReveal) this.enqueueReveal(r.beastId, 'pull', false, r.shiny);
    }
    this.events.emit('pulled', { mountainId, results });
    return { ok: true, results };
  }

  grantTickets(n: number): void {
    this.state.tickets += n;
  }

  // ------------------------------------------------------------ 现身拍符

  private enqueueReveal(beastId: string, source: RevealSource, isBoss: boolean, shiny: boolean): PendingReveal {
    const p: PendingReveal = { id: ++this.revealSeq, beastId, rarity: this.idx.beast[beastId].rarity, source, isBoss, shiny };
    this.revealQueue.push(p);
    this.events.emit('revealQueued', p);
    return p;
  }

  createRevealSession(p: PendingReveal): RevealSession {
    return new RevealSession(this.idx.cfg.reveal, this.idx.beast[p.beastId], { rng: this.rng, isBoss: p.isBoss });
  }

  /** 拍符结束（或跳过）后结算奖励并移出队列。跳过时 seals 传 reveal.skipSeals。 */
  finishReveal(p: PendingReveal, seals: number): RevealReward {
    const ctx = this.ctx();
    const rv = this.idx.cfg.reveal.rewards;
    const out: RevealReward = { seals, gold: 0, exp: 0, shards: 0, dianjing: false };
    const b = this.state.beasts[p.beastId];
    if (seals >= 3) {
      out.shards += rv.threeSeals.shards;
      if (!b.shiny && this.rng.chance(rv.threeSeals.dianjingChance)) {
        b.shiny = true;
        out.dianjing = true;
      } else if (b.shiny) {
        out.shards += 1;
      }
      b.shards += out.shards;
    } else if (seals === 2) {
      out.gold = rv.twoSeals.goldMinutes * idle.idleGoldPerMin(ctx);
      out.exp = rv.twoSeals.goldMinutes * idle.idleExpPerMin(ctx);
      this.state.gold += out.gold;
      this.state.exp += out.exp;
    }
    this.state.stats.reveals += 1;
    this.state.stats.perfects += seals;
    const i = this.revealQueue.indexOf(p);
    if (i >= 0) this.revealQueue.splice(i, 1);
    this.events.emit('beastChanged', { beastId: p.beastId });
    return out;
  }

  // ------------------------------------------------------------ 闯关（临时按战力判定，等实时战斗模块替换）

  /** 挑战下一关（只在玩家主动点"挑战"时调用，挂机不会自己推关）。useAssist 为 true 表示玩家已看完助战广告。 */
  challengeStage(useAssist = false): ChallengeResult {
    const ctx = this.ctx();
    const info = stage.nextStageInfo(ctx);
    if (!info) return { win: false, power: 0, enemyPower: 0 };
    const mult = useAssist ? stage.useAssist(ctx) : 1;
    const power = progression.teamPower(ctx) * mult;
    const win = power >= info.enemyPower;
    if (win) {
      const reward = stage.completeStage(ctx) as stage.StageReward;
      if (reward.captureBeast) {
        collection.addBeast(ctx, reward.captureBeast);
        this.enqueueReveal(reward.captureBeast, 'boss', true, false);
      }
      if (reward.wildRoll) this.tryWildEncounter();
      this.events.emit('stageCleared', { stage: this.state.stage, reward });
    }
    return { win, power, enemyPower: info.enemyPower };
  }

  challengeFloor(useAssist = false): ChallengeResult {
    const ctx = this.ctx();
    if (!stage.towerUnlocked(ctx)) return { win: false, power: 0, enemyPower: 0 };
    const enemyPower = stage.nextFloorPower(ctx);
    const mult = useAssist ? stage.useAssist(ctx) : 1;
    const power = progression.teamPower(ctx) * mult;
    const win = power >= enemyPower;
    if (win) {
      const reward = stage.completeFloor(ctx) as stage.FloorReward;
      this.events.emit('floorCleared', { floor: this.state.floor, reward });
    }
    return { win, power, enemyPower };
  }

  canQuickChallenge(): boolean {
    return stage.canQuickChallenge(this.ctx());
  }

  // ------------------------------------------------------------ 野遇

  /** 有次数时生成一次野遇（异兽先入库，再进入现身拍符）。 */
  tryWildEncounter(): PendingReveal | null {
    const ctx = this.ctx();
    if (!idle.canWildEncounter(ctx)) return null;
    const e = gacha.rollEncounter(ctx);
    if (!e) return null;
    this.state.daily.wildEncounters += 1;
    collection.addBeast(ctx, e.beastId, { shiny: e.shiny });
    return this.enqueueReveal(e.beastId, 'wild', false, e.shiny);
  }

  /** 领取挂机累积的野遇（上线时调用）。 */
  claimStoredWild(): PendingReveal[] {
    const out: PendingReveal[] = [];
    while (this.state.wildStore > 0) {
      const p = this.tryWildEncounter();
      if (!p) break;
      this.state.wildStore -= 1;
      out.push(p);
    }
    return out;
  }

  // ------------------------------------------------------------ 升级

  levelCost(beastId: string): progression.LevelCost {
    return progression.levelCostOf(this.ctx(), beastId);
  }

  canLevelUp(beastId: string): boolean {
    return progression.canLevelUp(this.ctx(), beastId);
  }

  levelUp(beastId: string, times = 1): number {
    const n = progression.levelUp(this.ctx(), beastId, times);
    if (n) this.events.emit('beastChanged', { beastId });
    return n;
  }

  /** 一键升级：给上阵异兽里等级最低的轮流升级，直到金币或经验不够。 */
  upgradeTeam(): number {
    const n = progression.upgradeTeam(this.ctx());
    if (n) this.events.emit('teamChanged', this.state.team);
    return n;
  }

  nextTeamUpgradeCost(): progression.LevelCost | null {
    return progression.nextTeamUpgradeCost(this.ctx());
  }

  /** 重置：回到 1 级，全额返还金币和经验，装备卸到背包。 */
  resetBeast(beastId: string): progression.ResetResult | null {
    const r = progression.resetBeast(this.ctx(), beastId);
    if (r) this.events.emit('beastChanged', { beastId });
    return r;
  }

  // ------------------------------------------------------------ 装备

  itemPct(it: Item): number {
    return equipSys.itemPct(this.ctx(), it);
  }

  dismantleValue(it: Item): number {
    return equipSys.dismantleValue(this.ctx(), it);
  }

  equip(beastId: string, itemId: number): boolean {
    const ok = equipSys.equip(this.ctx(), beastId, itemId);
    if (ok) this.events.emit('beastChanged', { beastId });
    return ok;
  }

  unequip(beastId: string, slot: number): boolean {
    const ok = equipSys.unequip(this.ctx(), beastId, slot);
    if (ok) this.events.emit('beastChanged', { beastId });
    return ok;
  }

  /** 一键穿戴：给指定异兽（默认上阵的）换上背包里更好的装备。 */
  equipBest(beastIds?: string[]): number {
    const n = equipSys.equipBest(this.ctx(), beastIds || this.teamIds());
    if (n) this.events.emit('teamChanged', this.state.team);
    return n;
  }

  hasEquipUpgrade(beastIds?: string[]): boolean {
    return equipSys.hasUpgrade(this.ctx(), beastIds || this.teamIds());
  }

  /** 一键分解：背包里低于 keepFrom 品质的装备换成金币。 */
  dismantleBag(keepFrom: Rarity = 'xi'): { count: number; gold: number } {
    return equipSys.dismantleBag(this.ctx(), keepFrom);
  }

  dismantleOne(itemId: number): number {
    return equipSys.dismantleOne(this.ctx(), itemId);
  }

  // ------------------------------------------------------------ 阵容

  autoTeam(): void {
    progression.setTeam(this.ctx(), progression.bestTeam(this.ctx()));
    this.events.emit('teamChanged', this.state.team);
  }

  /** 空阵位自动补上还没上阵的异兽（新获得异兽、开放新阵位后调用）。 */
  fillEmptySlots(): number {
    const n = progression.fillEmptySlots(this.ctx());
    if (n) this.events.emit('teamChanged', this.state.team);
    return n;
  }

  setTeam(team: (string | null)[]): boolean {
    const ok = progression.setTeam(this.ctx(), team);
    if (ok) this.events.emit('teamChanged', this.state.team);
    return ok;
  }

  canStarUp(beastId: string, useWild = false): boolean {
    return collection.canStarUp(this.ctx(), beastId, useWild);
  }

  /** 下一星需要的星魄，满星返回 null。 */
  starUpCost(beastId: string): number | null {
    return collection.starUpCost(this.ctx(), beastId);
  }

  starUp(beastId: string, useWild = false): boolean {
    const ok = collection.starUp(this.ctx(), beastId, useWild);
    if (ok) this.events.emit('beastChanged', { beastId });
    return ok;
  }

  awaken(beastId: string, useWild = false): boolean {
    const ok = collection.awaken(this.ctx(), beastId, useWild);
    if (ok) this.events.emit('beastChanged', { beastId });
    return ok;
  }

  melt(beastId: string, count: number): number {
    const n = collection.melt(this.ctx(), beastId, count);
    if (n > 0) this.events.emit('beastChanged', { beastId });
    return n;
  }

  // ------------------------------------------------------------ 挂机宝箱与签到

  chestFull(): boolean {
    return idle.chestFull(this.ctx());
  }

  chestEmpty(): boolean {
    return idle.chestEmpty(this.ctx());
  }

  /** 领取挂机宝箱。mult 为看广告倍数（金币、经验翻倍）。 */
  claimChest(mult = 1): idle.ChestClaim {
    const res = idle.claimChest(this.ctx(), mult);
    this.events.emit('chestClaimed', res);
    return res;
  }

  canClaimSignin(): boolean {
    return daily.canClaimSignin(this.ctx());
  }

  claimSignin(choice?: string): daily.SigninResult | null {
    const ctx = this.ctx();
    const res = daily.claimSignin(ctx, idle.idleGoldPerMin(ctx), idle.idleExpPerMin(ctx), choice);
    if (res && res.beastId) {
      const added = collection.addBeast(ctx, res.beastId);
      const r = this.idx.beast[res.beastId].rarity;
      if (this.idx.cfg.reveal.trigger.signin.indexOf(r) >= 0) this.enqueueReveal(res.beastId, 'signin', false, false);
      else this.events.emit('beastChanged', { beastId: added.beastId });
    }
    return res;
  }
}
