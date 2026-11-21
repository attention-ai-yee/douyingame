import { Element } from '../types';
import { TEAM_SIZE } from '../state';
import { Ctx } from './context';
import { unequipAll } from './equip';

export function slotsAvailable(ctx: Ctx): number {
  return ctx.f.slotsAt(ctx.s.stage);
}

/** 单只战力（含等级、装备）。 */
export function unitPowerOf(ctx: Ctx, beastId: string): number {
  const b = ctx.s.beasts[beastId];
  return b ? ctx.f.unitPower(beastId, b.star, b.awaken, b.shiny, b.level, b.equip) : 0;
}

/** 全队战力 = Σ 单只战力 × 羁绊系数。只计算已开放的阵位。 */
export function teamPower(ctx: Ctx, team: (string | null)[] = ctx.s.team): number {
  const k = slotsAvailable(ctx);
  let sum = 0;
  const els: Element[] = [];
  for (let i = 0; i < Math.min(k, team.length); i++) {
    const id = team[i];
    if (!id || !ctx.s.beasts[id]) continue;
    sum += unitPowerOf(ctx, id);
    els.push(ctx.idx.beast[id].element);
  }
  return sum * ctx.f.synergyMult(els);
}

/** 上阵最强：按单只战力取前 N 只。（不考虑羁绊和克制，后续可以改成搜索。） */
export function bestTeam(ctx: Ctx): (string | null)[] {
  const k = slotsAvailable(ctx);
  const ids = Object.keys(ctx.s.beasts).sort((a, b) => unitPowerOf(ctx, b) - unitPowerOf(ctx, a)).slice(0, k);
  const team: (string | null)[] = [];
  for (let i = 0; i < TEAM_SIZE; i++) team.push(i < ids.length ? ids[i] : null);
  return team;
}

/** 把还没上阵的异兽按战力填进空着的阵位（不动已上阵的）。返回填了几只。 */
export function fillEmptySlots(ctx: Ctx): number {
  const k = slotsAvailable(ctx);
  const onTeam: Record<string, boolean> = {};
  for (const id of ctx.s.team) if (id) onTeam[id] = true;
  const spare = Object.keys(ctx.s.beasts)
    .filter((id) => !onTeam[id])
    .sort((a, b) => unitPowerOf(ctx, b) - unitPowerOf(ctx, a));
  let n = 0;
  for (let i = 0; i < k && spare.length; i++) {
    if (!ctx.s.team[i] || !ctx.s.beasts[ctx.s.team[i] as string]) {
      ctx.s.team[i] = spare.shift() as string;
      n++;
    }
  }
  return n;
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

export function teamIds(ctx: Ctx): string[] {
  const k = slotsAvailable(ctx);
  const out: string[] = [];
  for (let i = 0; i < Math.min(k, ctx.s.team.length); i++) {
    const id = ctx.s.team[i];
    if (id && ctx.s.beasts[id]) out.push(id);
  }
  return out;
}

// ------------------------------------------------------------ 升级

export interface LevelCost {
  gold: number;
  exp: number;
}

export function levelCostOf(ctx: Ctx, beastId: string): LevelCost {
  const lv = ctx.s.beasts[beastId].level;
  return { gold: ctx.f.levelCost(lv), exp: ctx.f.levelExpCost(lv) };
}

export function canLevelUp(ctx: Ctx, beastId: string): boolean {
  if (!ctx.s.beasts[beastId]) return false;
  const c = levelCostOf(ctx, beastId);
  return ctx.s.gold >= c.gold && ctx.s.exp >= c.exp;
}

/** 给一只异兽升 times 级（钱不够就停）。返回实际升了几级。 */
export function levelUp(ctx: Ctx, beastId: string, times = 1): number {
  let n = 0;
  while (n < times && canLevelUp(ctx, beastId)) {
    const c = levelCostOf(ctx, beastId);
    ctx.s.gold -= c.gold;
    ctx.s.exp -= c.exp;
    ctx.s.beasts[beastId].level += 1;
    n++;
  }
  return n;
}

/** 一键升级：反复给上阵异兽里等级最低（最便宜）的升 1 级，直到金币或经验不够。返回升了几级。 */
export function upgradeTeam(ctx: Ctx, maxLevels = 100000): number {
  const ids = teamIds(ctx);
  if (!ids.length) return 0;
  let n = 0;
  while (n < maxLevels) {
    let best = ids[0];
    for (const id of ids) if (ctx.s.beasts[id].level < ctx.s.beasts[best].level) best = id;
    if (!levelUp(ctx, best, 1)) break;
    n++;
  }
  return n;
}

/** 一键升级还差多少：给等级最低的上阵异兽升 1 级的花费。没有上阵异兽返回 null。 */
export function nextTeamUpgradeCost(ctx: Ctx): LevelCost | null {
  const ids = teamIds(ctx);
  if (!ids.length) return null;
  let best = ids[0];
  for (const id of ids) if (ctx.s.beasts[id].level < ctx.s.beasts[best].level) best = id;
  return levelCostOf(ctx, best);
}

export interface ResetResult {
  gold: number;
  exp: number;
  items: number;
}

/** 重置：等级回到 1 级，全额返还升级花掉的金币和经验，装备卸到背包。 */
export function resetBeast(ctx: Ctx, beastId: string): ResetResult | null {
  const b = ctx.s.beasts[beastId];
  if (!b) return null;
  const gold = ctx.f.levelTotalCost(b.level);
  const exp = gold * ctx.idx.cfg.progression.level.expRatio;
  ctx.s.gold += gold;
  ctx.s.exp += exp;
  b.level = 1;
  const items = unequipAll(ctx, beastId);
  return { gold, exp, items };
}
