import { emptyChest, Item } from '../state';
import { Ctx } from './context';
import { addToBag, dismantleValue, newItem } from './equip';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * 挂机（游戏设计文档 8、10.1）：首页的队伍一直在打小怪，产出先攒进挂机宝箱，玩家点宝箱领取。
 * 在线按 100% 攒，离线按 chest.offlineRatio 攒；宝箱最多攒 chest.capHours 小时，满了就不再增加。
 * 挂机效率只取决于打到哪（主线关卡和镇妖塔等效关卡取高的），不会自己推关。
 */

export function idleEqStage(ctx: Ctx): number {
  return ctx.f.idleEqStage(ctx.s.stage, ctx.s.floor);
}

export function idleGoldPerMin(ctx: Ctx): number {
  return ctx.f.goldPerMin(idleEqStage(ctx));
}

export function idleExpPerMin(ctx: Ctx): number {
  return ctx.f.expPerMin(idleEqStage(ctx));
}

/** 往宝箱里攒 dtMs 毫秒的挂机产出（ratio 为折算比例：在线 1，离线 offlineRatio）。返回实际计入的毫秒。 */
export function fillChest(ctx: Ctx, dtMs: number, ratio: number): number {
  const c = ctx.idx.cfg.progression.chest;
  const ch = ctx.s.chest;
  const real = Math.min(dtMs, Math.max(0, c.capHours * HOUR - ch.ms));
  if (real <= 0) return 0;
  ch.ms += real;
  const eff = real * ratio;
  ch.gold += (idleGoldPerMin(ctx) * eff) / MIN;
  ch.exp += (idleExpPerMin(ctx) * eff) / MIN;

  ch.equipClock += eff;
  const equipStep = c.equipEveryMinutes * MIN;
  while (ch.equipClock >= equipStep) {
    ch.equipClock -= equipStep;
    const it = newItem(ctx);
    if (ch.items.length < c.maxItems) ch.items.push(it);
    else ch.gold += dismantleValue(ctx, it);
  }
  ch.ticketClock += eff;
  const ticketStep = c.ticketEveryHours * HOUR;
  while (ch.ticketClock >= ticketStep) {
    ch.ticketClock -= ticketStep;
    ch.tickets += 1;
  }
  ch.shardClock += eff;
  const shardStep = c.fanShardEveryHours * HOUR;
  while (ch.shardClock >= shardStep) {
    ch.shardClock -= shardStep;
    ch.fanShards += 1;
  }
  return real;
}

/** 新手引导：往宝箱里额外放 minutes 分钟的产出和 items 件装备（不占宝箱时长）。 */
export function addBonusToChest(ctx: Ctx, minutes: number, items: number): void {
  const ch = ctx.s.chest;
  ch.gold += idleGoldPerMin(ctx) * minutes;
  ch.exp += idleExpPerMin(ctx) * minutes;
  for (let i = 0; i < items; i++) ch.items.push(newItem(ctx, { minQ: i === 0 ? 'ling' : undefined }));
}

export function chestFull(ctx: Ctx): boolean {
  return ctx.s.chest.ms >= ctx.idx.cfg.progression.chest.capHours * HOUR;
}

export function chestEmpty(ctx: Ctx): boolean {
  const ch = ctx.s.chest;
  return ch.gold < 1 && ch.exp < 1 && !ch.tickets && !ch.fanShards && !ch.items.length;
}

export interface ChestClaim {
  ms: number;
  gold: number;
  exp: number;
  tickets: number;
  fanShards: number;
  items: Item[];
  /** 背包放不下、自动分解得到的金币（已计入 gold 之外）。 */
  overflowGold: number;
}

/** 领取宝箱。mult 为看广告的倍数（金币、经验翻倍；装备、寻兽符、星魄不翻倍）。 */
export function claimChest(ctx: Ctx, mult = 1): ChestClaim {
  const ch = ctx.s.chest;
  const m = Math.max(1, mult);
  const out: ChestClaim = {
    ms: ch.ms,
    gold: ch.gold * m,
    exp: ch.exp * m,
    tickets: ch.tickets,
    fanShards: ch.fanShards,
    items: ch.items.slice(),
    overflowGold: 0,
  };
  ctx.s.gold += out.gold;
  ctx.s.exp += out.exp;
  ctx.s.tickets += out.tickets;
  ctx.s.wildShards.fan += out.fanShards;
  out.overflowGold = addToBag(ctx, out.items);
  // 计时器保留余数，下一箱接着算
  const keep = { equipClock: ch.equipClock, ticketClock: ch.ticketClock, shardClock: ch.shardClock };
  ctx.s.chest = emptyChest();
  ctx.s.chest.equipClock = keep.equipClock;
  ctx.s.chest.ticketClock = keep.ticketClock;
  ctx.s.chest.shardClock = keep.shardClock;
  return out;
}

/** 在线挂机：按真实经过的毫秒数往宝箱里攒，并累计野遇计时。 */
export function accrueOnline(ctx: Ctx, dtMs: number): void {
  if (dtMs <= 0) return;
  fillChest(ctx, dtMs, 1);
  tickWildClock(ctx, dtMs);
  ctx.s.lastActiveAt = ctx.now;
}

export interface OfflineResult {
  /** 这次离线往宝箱里攒了多久（已按宝箱上限截断）。 */
  ms: number;
  rawMs: number;
  /** 检测到系统时间被往回调。 */
  clockRollback: boolean;
}

/**
 * 回到前台时把离线时间的挂机产出攒进宝箱。
 * 时间被往回调（当前时间早于上次在线时间）时本次不计。
 */
export function computeOffline(ctx: Ctx): OfflineResult {
  const raw = ctx.now - ctx.s.lastActiveAt;
  ctx.s.lastActiveAt = ctx.now;
  if (raw < 0) return { ms: 0, rawMs: raw, clockRollback: true };
  tickWildClock(ctx, raw);
  const ms = fillChest(ctx, raw, ctx.idx.cfg.progression.chest.offlineRatio);
  return { ms, rawMs: raw, clockRollback: false };
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
