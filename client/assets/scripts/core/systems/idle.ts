import { Ctx } from './context';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function idleEqStage(ctx: Ctx): number {
  return ctx.f.idleEqStage(ctx.s.stage, ctx.s.floor);
}

/** 当前挂机每分钟金币（在线 100%，离线再乘 offlineRatio）。 */
export function idleGoldPerMin(ctx: Ctx): number {
  return ctx.f.goldPerMin(idleEqStage(ctx));
}

/** 在线挂机：按真实经过的毫秒数累加金币和野遇计时。 */
export function accrueOnline(ctx: Ctx, dtMs: number): number {
  if (dtMs <= 0) return 0;
  const gold = (idleGoldPerMin(ctx) * dtMs) / MIN;
  ctx.s.gold += gold;
  tickWildClock(ctx, dtMs);
  ctx.s.lastActiveAt = ctx.now;
  return gold;
}

export interface OfflineResult {
  /** 实际计入收益的离线时长（已按上限截断）。 */
  ms: number;
  rawMs: number;
  gold: number;
  /** 检测到系统时间被往回调。 */
  clockRollback: boolean;
}

/**
 * 回到前台时计算离线收益，结果放进 state.pendingOffline 等玩家点"领取"。
 * 时间被往回调（当前时间早于上次在线时间）时本次收益为 0。
 */
export function computeOffline(ctx: Ctx): OfflineResult {
  const g = ctx.idx.cfg.progression.gold;
  const raw = ctx.now - ctx.s.lastActiveAt;
  ctx.s.lastActiveAt = ctx.now;
  if (raw < 0) {
    return { ms: 0, rawMs: raw, gold: 0, clockRollback: true };
  }
  tickWildClock(ctx, raw);
  if (raw < (g.offlineMinMinutes || 0) * MIN) {
    // 离开太短：按在线挂机直接入账，不弹离线收益
    ctx.s.gold += (idleGoldPerMin(ctx) * raw) / MIN;
    return { ms: 0, rawMs: raw, gold: 0, clockRollback: false };
  }
  const ms = Math.min(raw, g.offlineCapHours * HOUR);
  const gold = ((idleGoldPerMin(ctx) * ms) / MIN) * g.offlineRatio;
  if (gold > 0) {
    const prev = ctx.s.pendingOffline;
    ctx.s.pendingOffline = { ms: (prev ? prev.ms : 0) + ms, gold: (prev ? prev.gold : 0) + gold };
  }
  return { ms, rawMs: raw, gold, clockRollback: false };
}

/** 领取离线收益，mult 为广告翻倍倍数（不看广告为 1）。 */
export function claimOffline(ctx: Ctx, mult: number): number {
  const p = ctx.s.pendingOffline;
  if (!p) return 0;
  const gold = p.gold * Math.max(1, mult);
  ctx.s.gold += gold;
  ctx.s.pendingOffline = null;
  return gold;
}

/** 挂机/离线每 idleEveryHours 小时累积 1 次野遇，最多存 idleStoreCap 次。 */
function tickWildClock(ctx: Ctx, dtMs: number): void {
  const w = ctx.idx.cfg.progression.wild;
  const step = w.idleEveryHours * HOUR;
  ctx.s.wildClockMs += dtMs;
  while (ctx.s.wildClockMs >= step) {
    ctx.s.wildClockMs -= step;
    ctx.s.wildStore = Math.min(w.idleStoreCap, ctx.s.wildStore + 1);
  }
  if (ctx.s.wildStore >= w.idleStoreCap) ctx.s.wildClockMs = Math.min(ctx.s.wildClockMs, step);
}

export function canWildEncounter(ctx: Ctx): boolean {
  return ctx.s.daily.wildEncounters < ctx.idx.cfg.progression.wild.dailyCap;
}
