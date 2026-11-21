import { Rng } from '../rng';
import { BeastDef, RevealBehavior, RevealConfig } from '../types';

/**
 * 现身拍符的判定逻辑（纯计算，不画图）。对应 游戏设计文档 5.3。
 *
 * 坐标与时间
 * - 角度 0～360，0 在正上方，dir = +1 为顺时针；时间单位毫秒，从 session 创建时算起。
 * - view 层每帧调用 advance(t) 后读 markerAngle / zones() 绘制。
 * - 玩家点击时用**触摸事件的时间戳**调用 throwAt(t)。t 可以比最近一帧略早，
 *   session 保留最近 300ms 的状态快照来回溯，所以 30 帧和 60 帧手机一样公平。
 *
 * 判定区
 * - 完美区角度 = 当前这一拍的最高转速 × 完美区时长 × sizeFactor，所以变速不会让时间窗口变小。
 * - 不错区在完美区两侧，各宽 goodWidthFactor 倍完美区；noGoodZone 时没有不错区。
 * - 一足（step）运动：符箓按格子跳，绿区正好占一格，相邻格算不错。
 *
 * 行为参数（RevealBehavior，配置在 beasts.json 的 reveal 字段）
 * - speed.tempo：转速按正弦起伏；twoSpeed：快慢两档随机切换；rampPerLap：每转一圈加速；
 *   decelNearZone：符箓接近绿区时减速。
 * - zones：count 个绿区，layout 为 single / mirror（对称两个）/ even（均分）；activeCount 表示同时只亮几个。
 * - zoneMove：timedJump 定时跳位置；cycle 在 segments 个位置间轮换；onThrowOpposite 每拍后跳到对面；
 *   onThrowNextCell 每拍后顺时针挪一格；drift 缓慢漂移。
 * - onThrow：每拍后转速乘 speedMul、是否反向。reverseTimed：定时反向。
 * - visual：只影响表现（变暗、遮挡、水位等），判定不受影响，由 view 层实现。
 */

export type Judge = 'perfect' | 'good' | 'miss';

export interface ZoneView {
  center: number;
  halfPerfect: number;
  halfGood: number;
  active: boolean;
}

export interface ThrowResult {
  index: number;
  t: number;
  judge: Judge;
  seal: boolean;
  /** 点击时符箓离最近绿区中心的时间差（毫秒），埋点用来校准完美区。 */
  deviationMs: number;
}

export interface Telegraph {
  kind: 'reverse' | 'jump' | 'fast';
  inMs: number;
}

interface Snapshot {
  t: number;
  angle: number;
  speed: number;
  zones: ZoneView[];
}

const HISTORY_MS = 300;
const TWO_PI = Math.PI * 2;

export function angleDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

function norm(a: number): number {
  return ((a % 360) + 360) % 360;
}

export class RevealSession {
  readonly beast: BeastDef;
  readonly throwsTotal: number;
  readonly throws: ThrowResult[] = [];
  private readonly cfg: RevealConfig;
  private readonly beh: RevealBehavior;
  private readonly rng: Rng;
  private readonly baseSpeed: number;
  private readonly perfectMs: number;

  private t = 0;
  private contAngle = 0;
  private travelled = 0;
  private dir = 1;
  private throwMul = 1;
  private zoneBase = 0;
  private active: boolean[] = [];
  private sealsCount = 0;
  private history: Snapshot[] = [];

  private nextReverseAt = Infinity;
  private nextJumpAt = Infinity;
  private nextActiveAt = Infinity;
  private nextTwoSpeedAt = Infinity;
  private twoSpeedFast = false;

  constructor(cfg: RevealConfig, beast: BeastDef, opts: { rng: Rng; isBoss?: boolean }) {
    this.cfg = cfg;
    this.beast = beast;
    this.beh = beast.reveal || {};
    this.rng = opts.rng;
    this.throwsTotal = cfg.throws;
    const r = cfg.rarity[beast.rarity];
    this.baseSpeed = (r.speed * 360) / 1000;
    this.perfectMs = r.perfectMs - (opts.isBoss ? cfg.bossPerfectMinusMs : 0);

    const beh = this.beh;
    this.zoneBase = 90 + this.rng.next() * 180;
    if (beh.zoneMove && beh.zoneMove.mode === 'onThrowNextCell') {
      const cell = 360 / beh.zoneMove.cells;
      this.zoneBase = Math.round(this.zoneBase / cell) * cell;
    }
    if (beh.motion && beh.motion.mode === 'step') {
      const st = beh.motion.stepDeg;
      this.zoneBase = Math.floor(this.zoneBase / st) * st + st / 2;
    }
    const n = this.zoneCount();
    const z = beh.zones;
    if (z && z.activeCount && z.activeCount < n) {
      this.pickActive();
      this.nextActiveAt = z.activeInterval || Infinity;
    } else {
      for (let i = 0; i < n; i++) this.active.push(true);
    }
    if (beh.reverseTimed) this.nextReverseAt = beh.reverseTimed.interval;
    if (beh.zoneMove && beh.zoneMove.mode === 'timedJump') this.nextJumpAt = beh.zoneMove.interval;
    if (beh.speed && beh.speed.mode === 'twoSpeed') this.nextTwoSpeedAt = this.rng.int(beh.speed.holdMin, beh.speed.holdMax);
    this.pushSnapshot();
  }

  // ------------------------------------------------------------ 给 view 读的状态

  get elapsed(): number {
    return this.t;
  }

  get markerAngle(): number {
    return this.judgedAngle();
  }

  get direction(): number {
    return this.dir;
  }

  get seals(): number {
    return this.sealsCount;
  }

  get throwsLeft(): number {
    return this.throwsTotal - this.throws.length;
  }

  get done(): boolean {
    return this.throws.length >= this.throwsTotal;
  }

  /** 传说兽的最后一拍是"挣脱拍"（转速 ×legendLastThrowSpeedMult），view 用来播演出。 */
  get isStruggleThrow(): boolean {
    return this.beast.rarity === 'chuanshuo' && this.throwsLeft === 1;
  }

  zones(): ZoneView[] {
    return this.buildZones();
  }

  /** 即将发生的变化（用来做视觉预告）。 */
  telegraph(): Telegraph | null {
    const beh = this.beh;
    if (beh.reverseTimed) {
      const lead = beh.reverseTimed.telegraph || 0;
      if (this.nextReverseAt - this.t <= lead) return { kind: 'reverse', inMs: this.nextReverseAt - this.t };
    }
    if (beh.zoneMove && beh.zoneMove.mode === 'timedJump') {
      const lead = beh.zoneMove.telegraph || 0;
      if (this.nextJumpAt - this.t <= lead) return { kind: 'jump', inMs: this.nextJumpAt - this.t };
    }
    if (beh.speed && beh.speed.mode === 'twoSpeed' && !this.twoSpeedFast) {
      const lead = beh.speed.telegraph || 0;
      if (this.nextTwoSpeedAt - this.t <= lead) return { kind: 'fast', inMs: this.nextTwoSpeedAt - this.t };
    }
    return null;
  }

  // ------------------------------------------------------------ 推进与拍符

  /** 推进到 tMs（只能往前）。 */
  advance(tMs: number): void {
    while (this.t < tMs) {
      const dt = Math.min(1, tMs - this.t);
      this.runTimers();
      const v = this.speedNow();
      this.contAngle += this.dir * v * dt;
      this.travelled += v * dt;
      if (this.beh.zoneMove && this.beh.zoneMove.mode === 'drift') this.zoneBase += (this.beh.zoneMove.degPerSec * dt) / 1000;
      this.t += dt;
      this.pushSnapshot();
    }
  }

  /** 在 tMs（触摸事件时间戳）拍出一张符。已拍完返回 null。 */
  throwAt(tMs: number): ThrowResult | null {
    if (this.done) return null;
    let snap: Snapshot;
    if (tMs >= this.t) {
      this.advance(tMs);
      snap = this.history[this.history.length - 1];
    } else {
      snap = this.snapshotAt(tMs);
    }
    const j = judgeSnapshot(snap);
    const seal = j.judge === 'perfect';
    if (seal) this.sealsCount += 1;
    const res: ThrowResult = { index: this.throws.length, t: tMs, judge: j.judge, seal, deviationMs: j.dist / Math.max(snap.speed, 1e-6) };
    this.throws.push(res);
    this.applyOnThrow();
    return res;
  }

  /** 如果现在拍会是什么判定（不消耗符）。view 可以用来做"在绿区内"的高亮。 */
  judgeNow(): Judge {
    return judgeSnapshot(this.history[this.history.length - 1]).judge;
  }

  // ------------------------------------------------------------ 内部

  private zoneCount(): number {
    const z = this.beh.zones;
    return (z && z.count) || 1;
  }

  private pickActive(): void {
    const n = this.zoneCount();
    const k = (this.beh.zones && this.beh.zones.activeCount) || n;
    const chosen = this.rng.sample(n, k);
    this.active = [];
    for (let i = 0; i < n; i++) this.active.push(chosen.indexOf(i) >= 0);
  }

  private modeFactor(): number {
    const s = this.beh.speed;
    if (!s || s.mode === 'constant') return 1;
    if (s.mode === 'tempo') return 1 + s.amp * Math.sin((TWO_PI * this.t) / s.period);
    if (s.mode === 'twoSpeed') return this.twoSpeedFast ? s.fast : s.slow;
    if (s.mode === 'rampPerLap') return Math.pow(1 + s.perLap, Math.floor(this.travelled / 360));
    if (s.mode === 'decelNearZone') {
      const a = this.judgedAngle();
      for (const z of this.centers()) if (angleDist(a, z.center) < s.rangeDeg && z.active) return s.factor;
      return 1;
    }
    return 1;
  }

  private capFactor(): number {
    const s = this.beh.speed;
    if (!s) return 1;
    if (s.mode === 'tempo') return 1 + s.amp;
    if (s.mode === 'twoSpeed') return Math.max(s.fast, s.slow, 1);
    if (s.mode === 'rampPerLap') return Math.pow(1 + s.perLap, Math.floor(this.travelled / 360));
    return 1;
  }

  private lastThrowMult(): number {
    return this.isStruggleThrow ? this.cfg.legendLastThrowSpeedMult : 1;
  }

  private speedNow(): number {
    return this.baseSpeed * this.throwMul * this.lastThrowMult() * this.modeFactor();
  }

  private speedCap(): number {
    return this.baseSpeed * this.throwMul * this.lastThrowMult() * this.capFactor();
  }

  private judgedAngle(): number {
    const m = this.beh.motion;
    if (m && m.mode === 'step') return norm(Math.floor(this.contAngle / m.stepDeg) * m.stepDeg + m.stepDeg / 2);
    return norm(this.contAngle);
  }

  private centers(): { center: number; active: boolean }[] {
    const beh = this.beh;
    const n = this.zoneCount();
    const out: { center: number; active: boolean }[] = [];
    let base = this.zoneBase;
    if (beh.zoneMove && beh.zoneMove.mode === 'cycle') {
      const seg = Math.floor(this.t / beh.zoneMove.interval) % beh.zoneMove.segments;
      base += (seg * 360) / beh.zoneMove.segments;
    }
    const layout = (beh.zones && beh.zones.layout) || (n === 2 ? 'mirror' : 'even');
    for (let i = 0; i < n; i++) {
      const off = layout === 'mirror' ? i * 180 : (i * 360) / n;
      out.push({ center: norm(base + off), active: this.active[i] !== false });
    }
    return out;
  }

  private buildZones(): ZoneView[] {
    const beh = this.beh;
    let halfP: number;
    let halfG: number;
    if (beh.motion && beh.motion.mode === 'step') {
      halfP = beh.motion.stepDeg / 2;
      halfG = beh.noGoodZone ? halfP : beh.motion.stepDeg * 1.5;
    } else {
      const size = (beh.zones && beh.zones.sizeFactor) || 1;
      halfP = (this.speedCap() * this.perfectMs * size) / 2;
      halfG = beh.noGoodZone ? halfP : halfP * (1 + 2 * this.cfg.goodWidthFactor);
    }
    return this.centers().map((c) => ({ center: c.center, active: c.active, halfPerfect: halfP, halfGood: halfG }));
  }

  private runTimers(): void {
    const beh = this.beh;
    if (beh.reverseTimed && this.t >= this.nextReverseAt) {
      this.dir = -this.dir;
      this.nextReverseAt += beh.reverseTimed.interval;
    }
    if (beh.zoneMove && beh.zoneMove.mode === 'timedJump' && this.t >= this.nextJumpAt) {
      const marker = this.judgedAngle();
      let pos = this.rng.next() * 360;
      for (let i = 0; i < 10 && angleDist(pos, marker) < 60; i++) pos = this.rng.next() * 360;
      this.zoneBase = pos;
      this.nextJumpAt += beh.zoneMove.interval;
    }
    if (beh.speed && beh.speed.mode === 'twoSpeed' && this.t >= this.nextTwoSpeedAt) {
      this.twoSpeedFast = !this.twoSpeedFast;
      this.nextTwoSpeedAt += this.rng.int(beh.speed.holdMin, beh.speed.holdMax);
    }
    if (beh.zones && beh.zones.activeInterval && this.t >= this.nextActiveAt) {
      this.pickActive();
      this.nextActiveAt += beh.zones.activeInterval;
    }
  }

  private applyOnThrow(): void {
    const beh = this.beh;
    if (beh.onThrow) {
      if (beh.onThrow.speedMul) this.throwMul *= beh.onThrow.speedMul;
      if (beh.onThrow.reverse) this.dir = -this.dir;
    }
    const zm = beh.zoneMove;
    if (zm && zm.mode === 'onThrowOpposite') this.zoneBase += 180;
    if (zm && zm.mode === 'onThrowNextCell') this.zoneBase += 360 / zm.cells;
  }

  private pushSnapshot(): void {
    this.history.push({ t: this.t, angle: this.judgedAngle(), speed: this.speedNow(), zones: this.buildZones() });
    // 攒够两倍窗口再一次性裁掉旧快照，避免每毫秒 splice
    if (this.history.length > HISTORY_MS * 2) {
      const cut = this.t - HISTORY_MS;
      let drop = 0;
      while (drop < this.history.length - 1 && this.history[drop].t < cut) drop++;
      if (drop > 0) this.history.splice(0, drop);
    }
  }

  private snapshotAt(tMs: number): Snapshot {
    let best = this.history[0];
    for (const s of this.history) {
      if (s.t <= tMs) best = s;
      else break;
    }
    return best;
  }
}

function judgeSnapshot(snap: Snapshot): { judge: Judge; dist: number } {
  let best = Infinity;
  let judge: Judge = 'miss';
  for (const z of snap.zones) {
    if (!z.active) continue;
    const d = angleDist(snap.angle, z.center);
    if (d < best) best = d;
    if (d <= z.halfPerfect) judge = 'perfect';
    else if (d <= z.halfGood && judge !== 'perfect') judge = 'good';
  }
  return { judge, dist: best };
}

/** 跳过拍符时的印数。 */
export function skipSeals(cfg: RevealConfig): number {
  return cfg.skipSeals;
}
