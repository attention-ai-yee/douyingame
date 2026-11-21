import { DepthId, Rarity, RARITIES, rarityAtLeast } from '../types';
import { addBeast, AddBeastResult } from './collection';
import { Ctx } from './context';

export interface PullResult extends AddBeastResult {
  rarity: Rarity;
  shiny: boolean;
  /** 这一抽触发了哪个保底。 */
  pity: 'xi' | 'chuanshuo' | null;
  /** 是否需要进入现身拍符（稀有及以上）。 */
  needsReveal: boolean;
}

const HIGH_FIRST: Rarity[] = ['chuanshuo', 'xi', 'ling', 'fan'];

export function mountainDepth(ctx: Ctx, mountainId: string): DepthId | null {
  const m = ctx.idx.mountain[mountainId];
  if (!m) return null;
  return ctx.f.depthOf(m.chapter, ctx.s.stage);
}

/** 当前探索度下的各档概率（给"概率说明"界面用）。 */
export function currentRates(ctx: Ctx, mountainId: string): Record<Rarity, number> | null {
  const d = mountainDepth(ctx, mountainId);
  return d ? ctx.idx.cfg.pools.depths[d].rates : null;
}

/**
 * 进山 count 次（扣费由 GameCore 处理）。每次：按探索度掷稀有度 → 保底修正 → 十连保底 → 档内按权重选兽 → 掷闪光 → 入库。
 */
export function pull(ctx: Ctx, mountainId: string, count: number): PullResult[] {
  const depth = mountainDepth(ctx, mountainId);
  if (!depth) return [];
  const pools = ctx.idx.cfg.pools;
  const m = ctx.idx.mountain[mountainId];
  const rates = pools.depths[depth].rates;
  const trigger = ctx.idx.cfg.reveal.trigger.pull;
  const results: PullResult[] = [];
  let tenGuaranteeMet = false;

  for (let i = 0; i < count; i++) {
    ctx.s.pity.sinceXi += 1;
    ctx.s.pity.sinceChuanshuo += 1;
    let r = rollRarity(ctx, rates);
    let pity: PullResult['pity'] = null;
    if (ctx.s.pity.sinceChuanshuo >= pools.pity.chuanshuo) {
      r = 'chuanshuo';
      pity = 'chuanshuo';
    } else if (ctx.s.pity.sinceXi >= pools.pity.xi && !rarityAtLeast(r, 'xi')) {
      r = 'xi';
      pity = 'xi';
    }
    // 十连保底：前 9 抽都没出灵及以上，第 10 抽至少是灵
    if (count >= 10 && i === count - 1 && !tenGuaranteeMet && !rarityAtLeast(r, pools.tenPullMinRarity)) {
      r = pools.tenPullMinRarity;
    }
    if (rarityAtLeast(r, pools.tenPullMinRarity)) tenGuaranteeMet = true;
    if (r === 'chuanshuo') {
      ctx.s.pity.sinceChuanshuo = 0;
      ctx.s.pity.sinceXi = 0;
    } else if (r === 'xi') {
      ctx.s.pity.sinceXi = 0;
    }
    const beastId = ctx.rng.weighted(m.tiers[r]);
    const shiny = ctx.rng.chance(pools.shinyRate);
    const added = addBeast(ctx, beastId, { shiny });
    ctx.s.stats.pulls += 1;
    results.push({ ...added, rarity: r, shiny, pity, needsReveal: trigger.indexOf(r) >= 0 });
  }
  return results;
}

function rollRarity(ctx: Ctx, rates: Record<Rarity, number>): Rarity {
  const x = ctx.rng.next();
  let acc = 0;
  for (const r of HIGH_FIRST) {
    acc += rates[r];
    if (x < acc) return r;
  }
  return RARITIES[0];
}

/** 单只遭遇（野遇用）：在当前章节的山里按探索度掷一只。 */
export function rollEncounter(ctx: Ctx): { beastId: string; rarity: Rarity; shiny: boolean } | null {
  const chapter = Math.min(ctx.f.chapterOfStage(ctx.s.stage + 1), ctx.idx.cfg.stages.chapters.length);
  const m = ctx.idx.mountainOfChapter[chapter];
  if (!m) return null;
  const depth = ctx.f.depthOf(m.chapter, ctx.s.stage) || 'shallow';
  const r = rollRarity(ctx, ctx.idx.cfg.pools.depths[depth].rates);
  return { beastId: ctx.rng.weighted(m.tiers[r]), rarity: r, shiny: ctx.rng.chance(ctx.idx.cfg.pools.shinyRate) };
}
