import { BeastDef, ChapterDef, DepthId, GameConfig, MountainDef, RARITIES, ELEMENTS, CONFIG_FILES } from './types';

/** 配置索引：按 id 查异兽、山脉、章节。 */
export interface ConfigIndex {
  cfg: GameConfig;
  beast: Record<string, BeastDef>;
  mountain: Record<string, MountainDef>;
  mountainOfChapter: Record<number, MountainDef>;
  chapter: Record<number, ChapterDef>;
  maxStage: number;
}

export function indexConfig(cfg: GameConfig): ConfigIndex {
  const beast: Record<string, BeastDef> = {};
  for (const b of cfg.beasts.beasts) beast[b.id] = b;
  const mountain: Record<string, MountainDef> = {};
  const mountainOfChapter: Record<number, MountainDef> = {};
  for (const m of cfg.pools.mountains) {
    mountain[m.id] = m;
    mountainOfChapter[m.chapter] = m;
  }
  const chapter: Record<number, ChapterDef> = {};
  for (const c of cfg.stages.chapters) chapter[c.id] = c;
  return { cfg, beast, mountain, mountainOfChapter, chapter, maxStage: cfg.stages.chapterLength * cfg.stages.chapters.length };
}

/** 把按文件名加载的 JSON 拼成 GameConfig（view 层加载 resources/config 后调用）。 */
export function assembleConfig(files: Record<string, unknown>): GameConfig {
  const out: Record<string, unknown> = {};
  for (const name of CONFIG_FILES) {
    if (!files[name]) throw new Error(`缺少配置文件 ${name}.json`);
    out[name] = files[name];
  }
  return out as unknown as GameConfig;
}

const EPS = 1e-6;

/**
 * 配置校验。返回错误列表，空数组表示通过。
 * 规则来自 游戏设计文档 4.2（兽池每档非空）、5.3（完美区 ≥ 70ms）、15（概率之和 = 100%）。
 */
export function validateConfig(cfg: GameConfig): string[] {
  const errs: string[] = [];
  const idx = indexConfig(cfg);

  // 异兽
  const seen: Record<string, boolean> = {};
  for (const b of cfg.beasts.beasts) {
    if (seen[b.id]) errs.push(`异兽 id 重复：${b.id}`);
    seen[b.id] = true;
    if (RARITIES.indexOf(b.rarity) < 0) errs.push(`${b.id} 稀有度无效：${b.rarity}`);
    if (ELEMENTS.indexOf(b.element) < 0) errs.push(`${b.id} 五行无效：${b.element}`);
    if (!cfg.beasts.roles[b.role]) errs.push(`${b.id} 定位无效：${b.role}`);
  }

  // 兽池
  for (const m of cfg.pools.mountains) {
    for (const r of RARITIES) {
      const tier = m.tiers[r];
      if (!tier || tier.length === 0) {
        errs.push(`兽池 ${m.id} 的 ${r} 档为空`);
        continue;
      }
      for (const [id, w] of tier) {
        const b = idx.beast[id];
        if (!b) errs.push(`兽池 ${m.id}/${r} 引用了不存在的异兽 ${id}`);
        else if (b.rarity !== r) errs.push(`兽池 ${m.id}/${r} 中 ${id} 的稀有度是 ${b.rarity}`);
        if (!(w > 0)) errs.push(`兽池 ${m.id}/${r} 中 ${id} 权重必须 > 0`);
      }
    }
    if (!idx.chapter[m.chapter]) errs.push(`兽池 ${m.id} 对应的第 ${m.chapter} 章不存在`);
  }
  for (const d of ['shallow', 'deep', 'secret'] as DepthId[]) {
    const rates = cfg.pools.depths[d] && cfg.pools.depths[d].rates;
    if (!rates) {
      errs.push(`缺少探索度 ${d}`);
      continue;
    }
    let sum = 0;
    for (const r of RARITIES) sum += rates[r] || 0;
    if (Math.abs(sum - 1) > EPS) errs.push(`探索度 ${d} 概率之和为 ${sum}，应为 1`);
  }

  // 养成
  const p = cfg.progression;
  if (p.star.costs.length !== 4 || p.star.mults.length !== 5) errs.push('星级：costs 应有 4 项、mults 应有 5 项');
  if (p.awaken.shardCosts.length !== 5 || p.awaken.essenceCosts.length !== 5 || p.awaken.mults.length !== 6) {
    errs.push('觉醒：shardCosts/essenceCosts 应有 5 项、mults 应有 6 项');
  }

  // 关卡分段要连续覆盖 2..maxStage
  let expect = 2;
  for (const s of cfg.stages.enemy.segments) {
    if (s.from !== expect) errs.push(`敌人增长分段不连续：期望从第 ${expect} 关开始，实际 ${s.from}`);
    expect = s.to + 1;
  }
  if (expect - 1 < idx.maxStage) errs.push(`敌人增长分段只覆盖到第 ${expect - 1} 关，主线共 ${idx.maxStage} 关`);
  for (const c of cfg.stages.chapters) {
    if (!idx.mountain[c.mountain]) errs.push(`第 ${c.id} 章引用了不存在的山脉 ${c.mountain}`);
    if (c.boss.captureBeast && !idx.beast[c.boss.captureBeast]) errs.push(`第 ${c.id} 章 Boss 收服的异兽 ${c.boss.captureBeast} 不存在`);
  }

  // 现身拍符：完美区时长不低于下限，多绿区不重叠
  const rv = cfg.reveal;
  const bossBeasts: Record<string, boolean> = {};
  for (const c of cfg.stages.chapters) if (c.boss.captureBeast) bossBeasts[c.boss.captureBeast] = true;
  for (const b of cfg.beasts.beasts) {
    const rr = rv.rarity[b.rarity];
    if (!rr) continue;
    const beh = b.reveal || {};
    let ms = rr.perfectMs - (bossBeasts[b.id] ? rv.bossPerfectMinusMs : 0);
    const size = (beh.zones && beh.zones.sizeFactor) || 1;
    if (beh.motion && beh.motion.mode === 'step') {
      const degPerMs = (rr.speed * 360) / 1000;
      ms = beh.motion.stepDeg / (degPerMs * maxSpeedFactor(beh) * lastThrowMult(cfg, b.rarity) * throwMulCap(cfg, beh));
    } else {
      ms *= size;
    }
    if (ms < rv.minPerfectMs - EPS) errs.push(`${b.name} 的完美区只有 ${ms.toFixed(1)}ms，低于下限 ${rv.minPerfectMs}ms`);
    const count = (beh.zones && beh.zones.count) || 1;
    if (count > 1) {
      const degPerMs = (rr.speed * 360) / 1000;
      const zoneDeg = degPerMs * maxSpeedFactor(beh) * rr.perfectMs * size;
      const total = count * zoneDeg * (beh.noGoodZone ? 1 : 1 + 2 * rv.goodWidthFactor);
      if (total > 360) errs.push(`${b.name} 的 ${count} 个判定区总宽 ${total.toFixed(0)}° 超过一圈，会重叠`);
    }
  }

  // 签到
  for (const s of cfg.signin.firstRound.concat(cfg.signin.laterRounds)) {
    if (s.beast && !idx.beast[s.beast]) errs.push(`签到第 ${s.day} 天的异兽 ${s.beast} 不存在`);
    if (s.choice) for (const id of s.choice) if (!idx.beast[id]) errs.push(`签到第 ${s.day} 天自选的异兽 ${id} 不存在`);
  }
  return errs;
}

/** 行为带来的最高瞬时转速倍数（不含逐拍加速）。 */
export function maxSpeedFactor(beh: GameConfig['beasts']['beasts'][number]['reveal']): number {
  const s = beh.speed;
  if (!s) return 1;
  if (s.mode === 'tempo') return 1 + s.amp;
  if (s.mode === 'twoSpeed') return Math.max(s.fast, s.slow, 1);
  return 1;
}

function lastThrowMult(cfg: GameConfig, rarity: string): number {
  return rarity === 'chuanshuo' ? cfg.reveal.legendLastThrowSpeedMult : 1;
}

function throwMulCap(cfg: GameConfig, beh: GameConfig['beasts']['beasts'][number]['reveal']): number {
  const m = (beh.onThrow && beh.onThrow.speedMul) || 1;
  return Math.pow(m, Math.max(0, cfg.reveal.throws - 1));
}
