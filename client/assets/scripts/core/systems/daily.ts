import { emptyDaily } from '../state';
import { DailyTaskId, Rarity, SigninReward } from '../types';
import { Ctx } from './context';

/** 本地日期 YYYY-MM-DD。MVP 用设备时间；以后有服务器再换成服务器时间。 */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

/** 跨天时重置每日计数。返回是否发生了重置。 */
export function ensureDaily(ctx: Ctx): boolean {
  const key = dayKeyOf(ctx.now);
  if (ctx.s.daily.dayKey === key) return false;
  ctx.s.daily = emptyDaily(key);
  return true;
}

// ------------------------------------------------------------ 签到（断签不重置，只顺延）

export function currentSigninReward(ctx: Ctx): SigninReward {
  const cfg = ctx.idx.cfg.signin;
  const list = ctx.s.signin.round === 0 ? cfg.firstRound : cfg.laterRounds;
  return list[ctx.s.signin.claimedInRound % list.length];
}

export function canClaimSignin(ctx: Ctx): boolean {
  return ctx.s.signin.lastClaimDayKey !== dayKeyOf(ctx.now);
}

export interface SigninResult {
  reward: SigninReward;
  /** 获得的异兽（自选或指定），GameCore 负责入库和现身拍符。 */
  beastId: string | null;
  goldGained: number;
  expGained: number;
}

/**
 * 领取今天的签到。自选奖励需要传入 choice（必须在可选列表里）。
 * 只发放货币类奖励；异兽由 GameCore 统一入库。
 */
export function claimSignin(ctx: Ctx, goldPerMin: number, expPerMin: number, choice?: string): SigninResult | null {
  if (!canClaimSignin(ctx)) return null;
  const reward = currentSigninReward(ctx);
  let beastId: string | null = reward.beast || null;
  if (reward.choice) {
    if (!choice || reward.choice.indexOf(choice) < 0) return null;
    beastId = choice;
  }
  if (reward.tickets) ctx.s.tickets += reward.tickets;
  if (reward.wild) for (const k in reward.wild) ctx.s.wildShards[k as Rarity] += reward.wild[k as Rarity] as number;
  const goldGained = reward.goldMinutes ? reward.goldMinutes * goldPerMin : 0;
  const expGained = reward.goldMinutes ? reward.goldMinutes * expPerMin : 0;
  ctx.s.gold += goldGained;
  ctx.s.exp += expGained;

  const cfg = ctx.idx.cfg.signin;
  const roundLen = (ctx.s.signin.round === 0 ? cfg.firstRound : cfg.laterRounds).length;
  ctx.s.signin.claimedInRound += 1;
  if (ctx.s.signin.claimedInRound >= roundLen) {
    ctx.s.signin.round += 1;
    ctx.s.signin.claimedInRound = 0;
  }
  ctx.s.signin.lastClaimDayKey = dayKeyOf(ctx.now);
  return { reward, beastId, goldGained, expGained };
}

// ------------------------------------------------------------ 每日任务（游戏设计文档 10.3）

export interface DailyTaskStatus {
  id: DailyTaskId;
  name: string;
  target: number;
  progress: number;
  tickets: number;
  done: boolean;
  claimed: boolean;
}

export function addTaskProgress(ctx: Ctx, id: DailyTaskId, n = 1): void {
  if (n <= 0) return;
  // 跨天重置由 GameCore.resume/tick 统一做，这里不能顺手重置（否则会把当天的免费十连等计数清掉）
  const t = ctx.s.daily.tasks;
  t[id] = (t[id] || 0) + n;
}

export function taskStatus(ctx: Ctx): DailyTaskStatus[] {
  const d = ctx.s.daily;
  return ctx.idx.cfg.progression.daily.tasks.map((def) => {
    const progress = Math.min(def.target, d.tasks[def.id] || 0);
    return { id: def.id, name: def.name, target: def.target, progress, tickets: def.tickets, done: progress >= def.target, claimed: !!d.taskClaimed[def.id] };
  });
}

/** 领一项任务的奖励（寻兽符）。返回得到几张，不能领返回 0。 */
export function claimTask(ctx: Ctx, id: DailyTaskId): number {
  const st = taskStatus(ctx).filter((x) => x.id === id)[0];
  if (!st || !st.done || st.claimed) return 0;
  ctx.s.daily.taskClaimed[id] = true;
  ctx.s.tickets += st.tickets;
  return st.tickets;
}

export function canClaimAllTasks(ctx: Ctx): boolean {
  const list = taskStatus(ctx);
  return !ctx.s.daily.allTasksClaimed && list.every((x) => x.done);
}

/** 全部完成的奖励：allDoneMinutes 分钟挂机量的金币和经验。 */
export function claimAllTasks(ctx: Ctx, goldPerMin: number, expPerMin: number): { gold: number; exp: number } | null {
  if (!canClaimAllTasks(ctx)) return null;
  const m = ctx.idx.cfg.progression.daily.allDoneMinutes;
  ctx.s.daily.allTasksClaimed = true;
  const gold = m * goldPerMin;
  const exp = m * expPerMin;
  ctx.s.gold += gold;
  ctx.s.exp += exp;
  return { gold, exp };
}

/** 有可以领的任务奖励（红点用）。 */
export function hasTaskReward(ctx: Ctx): boolean {
  return taskStatus(ctx).some((x) => x.done && !x.claimed) || canClaimAllTasks(ctx);
}
