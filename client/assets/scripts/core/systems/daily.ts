import { Rarity, SigninReward } from '../types';
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
  ctx.s.daily = { dayKey: key, freeTenPullsUsed: 0, wildEncounters: 0, assistsUsed: 0 };
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
