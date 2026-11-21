import { EQUIP_SLOTS, Item } from '../state';
import { Rarity, RARITIES } from '../types';
import { Ctx } from './context';

/**
 * 简版装备（游戏设计文档 7.5）：每只异兽 4 个装备位，品质凡/灵/稀/传说，每件只加一项属性的百分比。
 * 来源：挂机宝箱、Boss 首通。多余的分解成金币。
 */

// 不 import idle.ts，避免循环引用
function eqStageOf(ctx: Ctx): number {
  return ctx.f.idleEqStage(ctx.s.stage, ctx.s.floor);
}

export function newItem(ctx: Ctx, opts: { minQ?: Rarity; eqStage?: number } = {}): Item {
  const eq = opts.eqStage === undefined ? eqStageOf(ctx) : opts.eqStage;
  const q = ctx.f.rollQuality(eq, ctx.rng.next(), opts.minQ);
  const slot = ctx.rng.int(0, EQUIP_SLOTS - 1);
  return { id: ++ctx.s.itemSeq, slot, q, tier: ctx.f.itemTier(eq) };
}

export function itemPct(ctx: Ctx, it: Item): number {
  return ctx.f.itemPct(it.q, it.tier);
}

/** 分解一件装备能得的金币（按当前挂机效率）。 */
export function dismantleValue(ctx: Ctx, it: Item): number {
  return ctx.idx.cfg.progression.equip.quality[it.q].dismantleMinutes * ctx.f.goldPerMin(eqStageOf(ctx));
}

/** 放进背包；背包满了先分解最差的（返回因此得到的金币）。 */
export function addToBag(ctx: Ctx, items: Item[]): number {
  for (const it of items) ctx.s.bag.push(it);
  let gold = 0;
  const cap = ctx.idx.cfg.progression.equip.bagCap;
  if (ctx.s.bag.length > cap) {
    ctx.s.bag.sort((a, b) => itemPct(ctx, b) - itemPct(ctx, a));
    const extra = ctx.s.bag.splice(cap);
    for (const it of extra) gold += dismantleValue(ctx, it);
    ctx.s.gold += gold;
  }
  return gold;
}

/** 穿上背包里的一件装备，原来那件放回背包。 */
export function equip(ctx: Ctx, beastId: string, itemId: number): boolean {
  const b = ctx.s.beasts[beastId];
  const i = ctx.s.bag.findIndex((x) => x.id === itemId);
  if (!b || i < 0) return false;
  const it = ctx.s.bag[i];
  ctx.s.bag.splice(i, 1);
  const old = b.equip[it.slot];
  b.equip[it.slot] = it;
  if (old) ctx.s.bag.push(old);
  return true;
}

export function unequip(ctx: Ctx, beastId: string, slot: number): boolean {
  const b = ctx.s.beasts[beastId];
  if (!b || !b.equip[slot]) return false;
  ctx.s.bag.push(b.equip[slot] as Item);
  b.equip[slot] = null;
  return true;
}

export function unequipAll(ctx: Ctx, beastId: string): number {
  let n = 0;
  for (let s = 0; s < EQUIP_SLOTS; s++) if (unequip(ctx, beastId, s)) n++;
  return n;
}

/** 给这几只异兽各部位换上背包里更好的装备（先照顾排在前面的）。返回换了几件。 */
export function equipBest(ctx: Ctx, beastIds: string[]): number {
  let n = 0;
  for (const id of beastIds) {
    const b = ctx.s.beasts[id];
    if (!b) continue;
    for (let s = 0; s < EQUIP_SLOTS; s++) {
      const cur = b.equip[s];
      let best: Item | null = null;
      for (const it of ctx.s.bag) {
        if (it.slot !== s) continue;
        if (!best || itemPct(ctx, it) > itemPct(ctx, best)) best = it;
      }
      if (best && (!cur || itemPct(ctx, best) > itemPct(ctx, cur))) {
        equip(ctx, id, best.id);
        n++;
      }
    }
  }
  return n;
}

/** 有没有能换上的更好装备。 */
export function hasUpgrade(ctx: Ctx, beastIds: string[]): boolean {
  for (const id of beastIds) {
    const b = ctx.s.beasts[id];
    if (!b) continue;
    for (const it of ctx.s.bag) {
      const cur = b.equip[it.slot];
      if (!cur || itemPct(ctx, it) > itemPct(ctx, cur)) return true;
    }
  }
  return false;
}

/** 分解背包里品质低于 keepFrom 的装备，返回得到的金币。 */
export function dismantleBag(ctx: Ctx, keepFrom: Rarity = 'xi'): { count: number; gold: number } {
  const keepIdx = RARITIES.indexOf(keepFrom);
  let gold = 0;
  let count = 0;
  ctx.s.bag = ctx.s.bag.filter((it) => {
    if (RARITIES.indexOf(it.q) >= keepIdx) return true;
    gold += dismantleValue(ctx, it);
    count++;
    return false;
  });
  ctx.s.gold += gold;
  return { count, gold };
}

export function dismantleOne(ctx: Ctx, itemId: number): number {
  const i = ctx.s.bag.findIndex((x) => x.id === itemId);
  if (i < 0) return 0;
  const gold = dismantleValue(ctx, ctx.s.bag[i]);
  ctx.s.bag.splice(i, 1);
  ctx.s.gold += gold;
  return gold;
}
