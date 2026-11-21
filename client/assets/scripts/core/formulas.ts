import { ConfigIndex } from './config';
import { DepthId, Element } from './types';

/**
 * 数值公式。必须和 tools/sim/sim.py 的 Model 保持一致，改这里就要改那里并重跑模拟。
 * 对应 游戏设计文档 7.1（阵位）、7.2（星级）、8（关卡与金币）、18.4（镇妖塔）。
 */
export class Formulas {
  private readonly enemyBaseTbl: number[] = [];
  private readonly lnMain: number[] = [];
  /** 塔里强度等于主线最后一关的层数（约 253）。 */
  readonly towerFloorAtMainEnd: number;

  constructor(private readonly idx: ConfigIndex) {
    const e = idx.cfg.stages.enemy;
    this.enemyBaseTbl[1] = e.base;
    for (let n = 2; n <= idx.maxStage; n++) this.enemyBaseTbl[n] = this.enemyBaseTbl[n - 1] * this.segmentGrowth(n);
    for (let n = 1; n <= idx.maxStage; n++) this.lnMain[n] = Math.log(this.enemyBaseTbl[n]);
    const t = idx.cfg.stages.tower;
    this.towerFloorAtMainEnd = 1 + Math.log(this.enemyBaseTbl[idx.maxStage] / this.enemyBaseTbl[t.baseStage]) / Math.log(t.growth);
  }

  get maxStage(): number {
    return this.idx.maxStage;
  }

  private segmentGrowth(n: number): number {
    const segs = this.idx.cfg.stages.enemy.segments;
    for (const s of segs) if (n >= s.from && n <= s.to) return s.growth;
    return segs[segs.length - 1].growth;
  }

  // ------------------------------------------------------------ 主线

  enemyBase(n: number): number {
    return this.enemyBaseTbl[Math.max(1, Math.min(n, this.idx.maxStage))];
  }

  isChapterBoss(n: number): boolean {
    return n > 0 && n % this.idx.cfg.stages.chapterLength === 0;
  }

  isSmallBoss(n: number): boolean {
    return !this.isChapterBoss(n) && n % this.idx.cfg.stages.enemy.smallBossEvery === 0;
  }

  isTreasure(n: number): boolean {
    const g = this.idx.cfg.progression.gold;
    return n % g.treasureEvery === 0 && n % this.idx.cfg.stages.enemy.smallBossEvery !== 0;
  }

  /** 第 n 关敌方目标战力。新手关用固定值，之后按公式。 */
  enemyPower(n: number): number {
    const e = this.idx.cfg.stages.enemy;
    const tut = e.tutorialEnemyPower;
    if (n >= 1 && n <= tut.length) return tut[n - 1];
    let v = this.enemyBase(n);
    if (this.isChapterBoss(n)) v *= e.chapterBossMult;
    else if (this.isSmallBoss(n)) v *= e.smallBossMult;
    return v;
  }

  chapterOfStage(n: number): number {
    return Math.max(1, Math.ceil(n / this.idx.cfg.stages.chapterLength));
  }

  // ------------------------------------------------------------ 镇妖塔

  isTowerBoss(f: number): boolean {
    return f > 0 && f % this.idx.cfg.stages.tower.bossEvery === 0;
  }

  towerPower(f: number): number {
    const t = this.idx.cfg.stages.tower;
    const v = this.enemyBaseTbl[t.baseStage] * Math.pow(t.growth, f - 1);
    return this.isTowerBoss(f) ? v * t.bossMult : v;
  }

  /** 强度对应的主线等效关卡；超过最后一关后按最后一段的增长率外推。 */
  eqStageOfStrength(strength: number): number {
    const max = this.idx.maxStage;
    const ls = Math.log(strength);
    if (ls >= this.lnMain[max]) return max + (ls - this.lnMain[max]) / Math.log(this.segmentGrowth(max));
    for (let n = 1; n < max; n++) {
      if (this.lnMain[n + 1] > ls) return n + (ls - this.lnMain[n]) / (this.lnMain[n + 1] - this.lnMain[n]);
    }
    return max;
  }

  /** 塔层的等效关卡：强度在主线范围内按强度对应；超过后每层折算 postMainStagePerFloor 关。 */
  towerEqStage(floor: number): number {
    if (floor <= 0) return 0;
    const t = this.idx.cfg.stages.tower;
    if (floor <= this.towerFloorAtMainEnd) {
      return this.eqStageOfStrength(this.enemyBaseTbl[t.baseStage] * Math.pow(t.growth, floor - 1));
    }
    return this.idx.maxStage + t.postMainStagePerFloor * (floor - this.towerFloorAtMainEnd);
  }

  /** 挂机等效关卡 = max(主线, 塔)。 */
  idleEqStage(stage: number, floor: number): number {
    return Math.max(stage, this.towerEqStage(floor));
  }

  // ------------------------------------------------------------ 金币与阵位

  goldPerMin(eqStage: number): number {
    const g = this.idx.cfg.progression.gold;
    return g.perMinBase * Math.pow(g.perMinGrowth, Math.max(1, eqStage) - 1);
  }

  slotCost(level: number): number {
    const s = this.idx.cfg.progression.slot;
    return s.costBase * Math.pow(s.costGrowth, level - 1);
  }

  slotMult(level: number): number {
    return Math.pow(this.idx.cfg.progression.slot.statGrowth, level - 1);
  }

  slotsAt(stage: number): number {
    let k = 0;
    for (const u of this.idx.cfg.progression.slot.unlocks) if (stage >= u.stage) k = Math.max(k, u.slots);
    return k;
  }

  // ------------------------------------------------------------ 战力

  unitPower(beastId: string, star: number, awaken: number, shiny: boolean): number {
    const b = this.idx.beast[beastId];
    const p = this.idx.cfg.progression;
    const base = this.idx.cfg.beasts.rarities[b.rarity].power;
    const starMult = p.star.mults[Math.max(1, Math.min(star, p.star.mults.length)) - 1];
    const awkMult = p.awaken.mults[Math.max(0, Math.min(awaken, p.awaken.mults.length - 1))];
    return base * starMult * awkMult * (shiny ? 1 + p.star.shinyStatBonus : 1);
  }

  /** 羁绊战力系数（近似值，战斗里按具体效果结算）。 */
  synergyMult(elements: Element[]): number {
    const sp = this.idx.cfg.progression.synergyPower;
    const count: Record<string, number> = {};
    for (const e of elements) count[e] = (count[e] || 0) + 1;
    let m = 1;
    for (const k in count) {
      if (count[k] >= 2) m += sp.two;
      if (count[k] >= 4) m += sp.four;
    }
    return m;
  }

  // ------------------------------------------------------------ 探索度

  /** 某章山脉当前的探索度；章节未解锁返回 null。 */
  depthOf(chapter: number, stageCleared: number): DepthId | null {
    const len = this.idx.cfg.stages.chapterLength;
    const start = (chapter - 1) * len;
    if (stageCleared < start) return null;
    if (stageCleared >= chapter * len) return 'secret';
    return stageCleared - start >= this.idx.cfg.pools.deepUnlockWithinChapter ? 'deep' : 'shallow';
  }
}
