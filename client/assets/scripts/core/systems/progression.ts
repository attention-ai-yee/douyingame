import { Element } from '../types';
import { TEAM_SIZE } from '../state';
import { Ctx } from './context';

export function slotsAvailable(ctx: Ctx): number {
  return ctx.f.slotsAt(ctx.s.stage);
}

export function unitPowerOf(ctx: Ctx, beastId: string): number {
  const b = ctx.s.beasts[beastId];
  return b ? ctx.f.unitPower(beastId, b.star, b.awaken, b.shiny) : 0;
}

/** 全队战力 = Σ(单只战力 × 所在阵位系数) × 羁绊系数。只计算已开放的阵位。 */
export function teamPower(ctx: Ctx, team: (string | null)[] = ctx.s.team): number {
  const k = slotsAvailable(ctx);
  let sum = 0;
  const els: Element[] = [];
  for (let i = 0; i < Math.min(k, team.length); i++) {
    const id = team[i];
    if (!id || !ctx.s.beasts[id]) continue;
    sum += unitPowerOf(ctx, id) * ctx.f.slotMult(ctx.s.slotLevels[i]);
    els.push(ctx.idx.beast[id].element);
  }
  return sum * ctx.f.synergyMult(els);
}

/** 一键上阵最强：按单只战力取前 N 只，战力高的放等级高的阵位。（不考虑羁绊和克制，后续可以改成搜索。） */
export function bestTeam(ctx: Ctx): (string | null)[] {
  const k = slotsAvailable(ctx);
  const ids = Object.keys(ctx.s.beasts).sort((a, b) => unitPowerOf(ctx, b) - unitPowerOf(ctx, a)).slice(0, k);
  const slotOrder: number[] = [];
  for (let i = 0; i < k; i++) slotOrder.push(i);
  slotOrder.sort((a, b) => ctx.s.slotLevels[b] - ctx.s.slotLevels[a]);
  const team: (string | null)[] = [];
  for (let i = 0; i < TEAM_SIZE; i++) team.push(null);
  for (let i = 0; i < ids.length; i++) team[slotOrder[i]] = ids[i];
  return team;
}

export function setTeam(ctx: Ctx, team: (string | null)[]): boolean {
  const k = slotsAvailable(ctx);
  const used: Record<string, boolean> = {};
  const next: (string | null)[] = [];
  for (let i = 0; i < TEAM_SIZE; i++) {
    const id = i < team.length ? team[i] : null;
    if (id) {
      if (i >= k || !ctx.s.beasts[id] || used[id]) return false;
      used[id] = true;
    }
    next.push(id || null);
  }
  ctx.s.team = next;
  return true;
}

export function upgradeSlot(ctx: Ctx, i: number): boolean {
  if (i < 0 || i >= slotsAvailable(ctx)) return false;
  const cost = ctx.f.slotCost(ctx.s.slotLevels[i]);
  if (ctx.s.gold < cost) return false;
  ctx.s.gold -= cost;
  ctx.s.slotLevels[i] += 1;
  return true;
}

/** 一键升级：反复给当前最便宜的阵位升 1 级，直到金币不够。返回升了几级。 */
export function upgradeCheapest(ctx: Ctx, maxLevels = 100000): number {
  const k = slotsAvailable(ctx);
  let n = 0;
  while (n < maxLevels) {
    let best = 0;
    for (let i = 1; i < k; i++) if (ctx.s.slotLevels[i] < ctx.s.slotLevels[best]) best = i;
    if (!upgradeSlot(ctx, best)) break;
    n++;
  }
  return n;
}
