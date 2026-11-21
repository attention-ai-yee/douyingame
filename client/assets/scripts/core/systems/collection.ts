import { nextRarity, Rarity } from '../types';
import { Ctx } from './context';

export interface AddBeastResult {
  beastId: string;
  isNew: boolean;
  shardsGained: number;
  /** 这次让图鉴多了一只闪光。 */
  newShiny: boolean;
}

/** 获得一只异兽：新的入图鉴，重复的转星魄（闪光重复 ×2）。 */
export function addBeast(ctx: Ctx, beastId: string, opts: { shiny?: boolean; extraShards?: number } = {}): AddBeastResult {
  const p = ctx.idx.cfg.progression;
  const shiny = !!opts.shiny;
  const extra = opts.extraShards || 0;
  const b = ctx.s.beasts[beastId];
  if (!b) {
    ctx.s.beasts[beastId] = { star: 1, shards: extra, awaken: 0, shiny, obtainedAt: ctx.now };
    return { beastId, isNew: true, shardsGained: extra, newShiny: shiny };
  }
  const gained = (shiny ? p.star.shinyDupShards : 1) + extra;
  b.shards += gained;
  const newShiny = shiny && !b.shiny;
  if (newShiny) b.shiny = true;
  return { beastId, isNew: false, shardsGained: gained, newShiny };
}

export function rarityOf(ctx: Ctx, beastId: string): Rarity {
  return ctx.idx.beast[beastId].rarity;
}

// ------------------------------------------------------------ 升星

/** 下一星需要的星魄；已满星返回 null。 */
export function starUpCost(ctx: Ctx, beastId: string): number | null {
  const b = ctx.s.beasts[beastId];
  const costs = ctx.idx.cfg.progression.star.costs;
  if (!b || b.star >= costs.length + 1) return null;
  return costs[b.star - 1];
}

/** 能否升星。useWild 为 true 时自己的星魄不够可以用同档万能星魄补。 */
export function canStarUp(ctx: Ctx, beastId: string, useWild: boolean): boolean {
  const cost = starUpCost(ctx, beastId);
  if (cost === null) return false;
  const b = ctx.s.beasts[beastId];
  const wild = useWild ? ctx.s.wildShards[rarityOf(ctx, beastId)] : 0;
  return b.shards + wild >= cost;
}

export function starUp(ctx: Ctx, beastId: string, useWild: boolean): boolean {
  if (!canStarUp(ctx, beastId, useWild)) return false;
  const cost = starUpCost(ctx, beastId) as number;
  spendShards(ctx, beastId, cost);
  ctx.s.beasts[beastId].star += 1;
  return true;
}

// ------------------------------------------------------------ 觉醒（1.2）

export function awakenCost(ctx: Ctx, beastId: string): { shards: number; essence: number } | null {
  const a = ctx.idx.cfg.progression.awaken;
  const b = ctx.s.beasts[beastId];
  if (!a.enabled || !b || b.star < ctx.idx.cfg.progression.star.mults.length || b.awaken >= a.shardCosts.length) return null;
  return { shards: a.shardCosts[b.awaken], essence: a.essenceCosts[b.awaken] };
}

export function canAwaken(ctx: Ctx, beastId: string, useWild: boolean): boolean {
  const cost = awakenCost(ctx, beastId);
  if (!cost) return false;
  const b = ctx.s.beasts[beastId];
  const def = ctx.idx.beast[beastId];
  const wild = useWild ? ctx.s.wildShards[def.rarity] : 0;
  return b.shards + wild >= cost.shards && ctx.s.essence[def.element] >= cost.essence;
}

export function awaken(ctx: Ctx, beastId: string, useWild: boolean): boolean {
  if (!canAwaken(ctx, beastId, useWild)) return false;
  const cost = awakenCost(ctx, beastId) as { shards: number; essence: number };
  spendShards(ctx, beastId, cost.shards);
  ctx.s.essence[ctx.idx.beast[beastId].element] -= cost.essence;
  ctx.s.beasts[beastId].awaken += 1;
  return true;
}

// ------------------------------------------------------------ 熔炼

/** 把某只异兽的星魄熔炼成高一档万能星魄：每 ratio 个换 1 个。返回得到的数量。 */
export function melt(ctx: Ctx, beastId: string, count: number): number {
  const b = ctx.s.beasts[beastId];
  const ratio = ctx.idx.cfg.progression.melt.ratio;
  const to = nextRarity(rarityOf(ctx, beastId));
  if (!b || !to || count <= 0 || count % ratio !== 0 || b.shards < count) return 0;
  b.shards -= count;
  const out = count / ratio;
  ctx.s.wildShards[to] += out;
  return out;
}

export function shinyCount(ctx: Ctx): number {
  let n = 0;
  for (const id in ctx.s.beasts) if (ctx.s.beasts[id].shiny) n++;
  return n;
}

function spendShards(ctx: Ctx, beastId: string, cost: number): void {
  const b = ctx.s.beasts[beastId];
  const fromOwn = Math.min(b.shards, cost);
  b.shards -= fromOwn;
  const rest = cost - fromOwn;
  if (rest > 0) ctx.s.wildShards[rarityOf(ctx, beastId)] -= rest;
}
