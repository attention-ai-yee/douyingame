import { Rarity } from '../types';
import { Ctx } from './context';
import { idleGoldPerMin } from './idle';
import { teamPower } from './progression';

export interface StageInfo {
  stage: number;
  chapter: number;
  enemyPower: number;
  isSmallBoss: boolean;
  isChapterBoss: boolean;
  isTreasure: boolean;
}

export interface StageReward {
  gold: number;
  tickets: number;
  /** 章节 Boss 收服的异兽（需要走现身拍符），没有为 null。 */
  captureBeast: string | null;
  /** 这次通关新开放的阵位数（没有变化为 0）。 */
  slotsUnlockedTo: number;
  /** 是否触发野遇（由 GameCore 决定是否还有次数）。 */
  wildRoll: boolean;
}

export interface FloorReward {
  gold: number;
  tickets: number;
  wild: Partial<Record<Rarity, number>>;
}

export function nextStageInfo(ctx: Ctx): StageInfo | null {
  const n = ctx.s.stage + 1;
  if (n > ctx.idx.maxStage) return null;
  return {
    stage: n,
    chapter: ctx.f.chapterOfStage(n),
    enemyPower: ctx.f.enemyPower(n),
    isSmallBoss: ctx.f.isSmallBoss(n),
    isChapterBoss: ctx.f.isChapterBoss(n),
    isTreasure: ctx.f.isTreasure(n),
  };
}

/**
 * 战斗结果的临时判定：战力 ≥ 敌方即胜。
 * 真正的实时自动战斗做出来以后（游戏设计文档 6.2：同战力胜率 60%～70%），由战斗模块给出胜负，这里只做预估显示。
 */
export function winsByPower(ctx: Ctx, enemyPower: number, assistMult = 1): boolean {
  return teamPower(ctx) * assistMult >= enemyPower;
}

/** 通关下一关并发放首通奖励。只能按顺序通关。 */
export function completeStage(ctx: Ctx): StageReward | null {
  const info = nextStageInfo(ctx);
  if (!info) return null;
  const prevSlots = ctx.f.slotsAt(ctx.s.stage);
  ctx.s.stage = info.stage;
  const g = ctx.idx.cfg.progression.gold;
  let gold = g.firstClearMinutes * idleGoldPerMin(ctx);
  if (info.isTreasure) gold *= g.treasureMult;
  let tickets = 0;
  let captureBeast: string | null = null;
  if (info.isChapterBoss) {
    const ch = ctx.idx.chapter[info.chapter];
    tickets += ch.boss.rewardTickets;
    captureBeast = ch.boss.captureBeast;
  } else if (info.isSmallBoss) {
    tickets += ctx.idx.cfg.stages.rewards.smallBossTickets;
  }
  ctx.s.gold += gold;
  ctx.s.tickets += tickets;
  const nowSlots = ctx.f.slotsAt(ctx.s.stage);
  return {
    gold,
    tickets,
    captureBeast,
    slotsUnlockedTo: nowSlots > prevSlots ? nowSlots : 0,
    wildRoll: ctx.rng.chance(ctx.idx.cfg.progression.wild.stageClearChance),
  };
}

// ------------------------------------------------------------ 镇妖塔

export function towerUnlocked(ctx: Ctx): boolean {
  return ctx.s.stage >= ctx.idx.cfg.stages.tower.unlockStage;
}

export function nextFloorPower(ctx: Ctx): number {
  return ctx.f.towerPower(ctx.s.floor + 1);
}

/** 战力 ≥ 敌方 quickChallengeRatio 倍时可以跳过战斗。 */
export function canQuickChallenge(ctx: Ctx): boolean {
  return towerUnlocked(ctx) && teamPower(ctx) >= nextFloorPower(ctx) * ctx.idx.cfg.stages.tower.quickChallengeRatio;
}

export function completeFloor(ctx: Ctx): FloorReward | null {
  if (!towerUnlocked(ctx)) return null;
  const f = ++ctx.s.floor;
  const rw = ctx.idx.cfg.stages.tower.rewards;
  const gold = ctx.idx.cfg.progression.gold.firstClearMinutes * idleGoldPerMin(ctx);
  const tickets = f % rw.ticketsEvery === 0 ? rw.tickets : 0;
  const wild: Partial<Record<Rarity, number>> = {};
  if (f % rw.lingWildEvery === 0) wild.ling = 1;
  if (f % rw.xiWildEvery === 0) wild.xi = (wild.xi || 0) + 1;
  ctx.s.gold += gold;
  ctx.s.tickets += tickets;
  for (const k in wild) ctx.s.wildShards[k as Rarity] += wild[k as Rarity] as number;
  return { gold, tickets, wild };
}

export function canUseAssist(ctx: Ctx): boolean {
  return ctx.s.daily.assistsUsed < ctx.idx.cfg.progression.assist.dailyCap;
}

export function useAssist(ctx: Ctx): number {
  if (!canUseAssist(ctx)) return 1;
  ctx.s.daily.assistsUsed += 1;
  return ctx.idx.cfg.progression.assist.powerMult;
}
