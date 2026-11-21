/**
 * 主界面自动战斗的"表现用"模拟（纯计算，不依赖 Cocos，可单测）。
 *
 * 胜负由 core 按战力决定（GameCore.challengeStage）；这里只负责把这场战斗演出来：
 * 谁打谁、每下打多少、多久打完。结果和 core 的判定一致：赢的仗敌人一定先倒，输的仗我方一定先倒。
 * 以后做真正的实时战斗模块（游戏设计文档第 6 节）时替换这个文件。
 */

export interface SimUnit {
  hp: number;
  maxHp: number;
  alive: boolean;
  interval: number;
  next: number;
  /** 每下的基础伤害（显示用的大数字，和战力同一量级）。 */
  dmg: number;
}

export interface HitEvent {
  side: 'ally' | 'enemy';
  from: number;
  to: number;
  dmg: number;
  crit: boolean;
  killed: boolean;
}

export interface BattleSimOptions {
  /** 我方每只上阵异兽的战力（已含阵位、羁绊、助战）。 */
  allyPowers: number[];
  enemyCount: number;
  enemyPower: number;
  /** core 判定的结果。 */
  win: boolean;
  rng: () => number;
}

const CRIT_RATE = 0.1;
const CRIT_MULT = 1.5;

export class BattleSim {
  readonly allies: SimUnit[] = [];
  readonly enemies: SimUnit[] = [];
  /** 预计时长（毫秒）。 */
  readonly targetMs: number;
  t = 0;
  done = false;
  readonly win: boolean;
  private readonly rng: () => number;

  constructor(o: BattleSimOptions) {
    this.rng = o.rng;
    this.win = o.win;
    const power = Math.max(1, o.allyPowers.reduce((a, b) => a + b, 0));
    // 赢得越轻松打得越快：3.5～10 秒；输的仗固定约 7 秒
    this.targetMs = o.win ? clamp(3000 + (6000 * o.enemyPower) / power, 3500, 10000) : 7000;

    let allyHits = 0;
    let allyDmgTotal = 0;
    for (const p of o.allyPowers) {
      const interval = 900 + this.rng() * 300;
      const dmg = Math.max(1, p / 8);
      this.allies.push({ hp: p * 3, maxHp: p * 3, alive: true, interval, next: 200 + this.rng() * 400, dmg });
      allyHits += this.targetMs / interval;
      allyDmgTotal += (this.targetMs / interval) * dmg * (1 + CRIT_RATE * (CRIT_MULT - 1));
    }
    const enemyHp = (allyDmgTotal * (o.win ? 0.97 : 1.6)) / Math.max(1, o.enemyCount);
    let enemyHits = 0;
    for (let i = 0; i < o.enemyCount; i++) {
      const interval = 1100 + this.rng() * 300;
      this.enemies.push({ hp: enemyHp, maxHp: enemyHp, alive: true, interval, next: 400 + this.rng() * 500, dmg: 0 });
      enemyHits += this.targetMs / interval;
    }
    const allyHpTotal = this.allies.reduce((a, u) => a + u.maxHp, 0);
    const enemyDmg = (allyHpTotal * (o.win ? 0.55 : 1.15)) / Math.max(1, enemyHits);
    for (const e of this.enemies) e.dmg = enemyDmg;
    if (allyHits === 0) this.targetMs = 0;
  }

  /** 推进 dtMs，返回这段时间里发生的攻击。 */
  step(dtMs: number): HitEvent[] {
    const out: HitEvent[] = [];
    if (this.done) return out;
    this.t += dtMs;
    this.attackRound(this.allies, this.enemies, 'ally', out);
    this.attackRound(this.enemies, this.allies, 'enemy', out);
    // 兜底：超过预计时长太多时直接给出结果
    if (!this.done && this.t > this.targetMs * 2.5) {
      for (const u of this.win ? this.enemies : this.allies) {
        u.hp = 0;
        u.alive = false;
      }
    }
    if (this.enemies.every((u) => !u.alive) || this.allies.every((u) => !u.alive)) this.done = true;
    return out;
  }

  private attackRound(attackers: SimUnit[], targets: SimUnit[], side: 'ally' | 'enemy', out: HitEvent[]): void {
    for (let i = 0; i < attackers.length; i++) {
      const a = attackers[i];
      while (a.alive && this.t >= a.next) {
        a.next += a.interval;
        const to = this.pickTarget(targets, side);
        if (to < 0) return;
        const crit = this.rng() < CRIT_RATE;
        let dmg = a.dmg * (0.92 + this.rng() * 0.16) * (crit ? CRIT_MULT : 1);
        const tgt = targets[to];
        // 保证结局和 core 的判定一致：注定要赢的一方不会先倒下
        const protectedSide = (side === 'ally' && !this.win) || (side === 'enemy' && this.win);
        if (protectedSide && this.aliveCount(targets) === 1) dmg = Math.min(dmg, Math.max(0, tgt.hp - 1));
        tgt.hp -= dmg;
        const killed = tgt.hp <= 0;
        if (killed) {
          tgt.hp = 0;
          tgt.alive = false;
        }
        out.push({ side, from: i, to, dmg, crit, killed });
      }
    }
  }

  /** 我方集火第一个活着的敌人；敌人随机打。 */
  private pickTarget(targets: SimUnit[], side: 'ally' | 'enemy'): number {
    const alive: number[] = [];
    for (let i = 0; i < targets.length; i++) if (targets[i].alive) alive.push(i);
    if (!alive.length) return -1;
    return side === 'ally' ? alive[0] : alive[Math.floor(this.rng() * alive.length)];
  }

  private aliveCount(units: SimUnit[]): number {
    let n = 0;
    for (const u of units) if (u.alive) n++;
    return n;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
