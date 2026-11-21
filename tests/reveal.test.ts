import { describe, expect, it } from 'vitest';
import { BeastDef, RevealSession, Rng } from '../client/assets/scripts/core';
import { loadConfig } from './helpers';

const cfg = loadConfig();
const beast = (id: string): BeastDef => cfg.beasts.beasts.find((b) => b.id === id)!;

/** 从 session 当前时刻起扫一整圈，统计"现在点是完美"的毫秒数，即完美窗口时长。 */
function perfectWindowMs(s: RevealSession, scanMs: number): number {
  let n = 0;
  const start = s.elapsed;
  for (let t = start + 1; t <= start + scanMs; t++) {
    s.advance(t);
    if (s.judgeNow() === 'perfect') n++;
  }
  return n;
}

const periodMs = (rarity: keyof typeof cfg.reveal.rarity) => 1000 / cfg.reveal.rarity[rarity].speed;

describe('现身拍符：完美窗口按毫秒定义', () => {
  it('标准圆环（类，凡兽）≈ 140ms', () => {
    const s = new RevealSession(cfg.reveal, beast('lei'), { rng: new Rng(1) });
    expect(perfectWindowMs(s, periodMs('fan'))).toBeGreaterThanOrEqual(139);
    expect(perfectWindowMs(new RevealSession(cfg.reveal, beast('lei'), { rng: new Rng(1) }), periodMs('fan'))).toBeLessThanOrEqual(142);
  });

  it('陆吾第一拍 ≈ 110ms；作为 Boss 收服时 ≈ 100ms', () => {
    const normal = perfectWindowMs(new RevealSession(cfg.reveal, beast('luwu'), { rng: new Rng(2) }), periodMs('xi'));
    const boss = perfectWindowMs(new RevealSession(cfg.reveal, beast('luwu'), { rng: new Rng(2), isBoss: true }), periodMs('xi'));
    expect(normal).toBeGreaterThanOrEqual(109);
    expect(normal).toBeLessThanOrEqual(112);
    expect(boss).toBeGreaterThanOrEqual(99);
    expect(boss).toBeLessThanOrEqual(102);
  });

  it('应龙每拍加速 + 反向 + 挣脱拍 ×1.3，但第三拍的完美窗口仍然 ≥ 90ms', () => {
    const s = new RevealSession(cfg.reveal, beast('yinglong'), { rng: new Rng(3) });
    s.throwAt(500);
    s.throwAt(1200);
    expect(s.isStruggleThrow).toBe(true);
    // 第三拍转速 = 基础 × 1.15² × 1.3，扫一整圈
    const w = perfectWindowMs(s, Math.floor(periodMs('chuanshuo') / (1.15 * 1.15 * 1.3)));
    expect(w).toBeGreaterThanOrEqual(89);
    expect(w).toBeLessThanOrEqual(93);
  });

  it('毕方一足：按格子跳，窗口 = 一格停留时间 ≈ 104ms', () => {
    const w = perfectWindowMs(new RevealSession(cfg.reveal, beast('bifang'), { rng: new Rng(4) }), periodMs('xi'));
    expect(w).toBeGreaterThanOrEqual(100);
    expect(w).toBeLessThanOrEqual(108);
  });

  it('九尾狐：9 个小绿区，每次只亮 3 个', () => {
    const s = new RevealSession(cfg.reveal, beast('jiuweihu'), { rng: new Rng(5) });
    const z = s.zones();
    expect(z.length).toBe(9);
    expect(z.filter((x) => x.active).length).toBe(3);
    // 每个绿区的完美窗口 = 110ms × 0.65 ≈ 71.5ms ≥ 70ms
    const degPerMs = (cfg.reveal.rarity.xi.speed * 360) / 1000;
    expect((z[0].halfPerfect * 2) / degPerMs).toBeCloseTo(71.5, 0);
    expect(z[0].halfGood).toBe(z[0].halfPerfect); // 没有不错区
  });

  it('狰：每拍之后绿区跳到对面', () => {
    const s = new RevealSession(cfg.reveal, beast('zheng'), { rng: new Rng(6) });
    const before = s.zones()[0].center;
    s.throwAt(100);
    const after = s.zones()[0].center;
    expect(Math.abs(((after - before + 360) % 360) - 180)).toBeLessThan(1e-6);
  });

  it('点击时间戳比当前帧早时，按当时的位置判定', () => {
    const s = new RevealSession(cfg.reveal, beast('lei'), { rng: new Rng(7) });
    // 找到第一个完美时刻
    let tp = 0;
    for (let t = 1; t < 2000; t++) {
      s.advance(t);
      if (s.judgeNow() === 'perfect') {
        tp = t + 20; // 往里走一点，避开边缘
        break;
      }
    }
    s.advance(tp + 120); // 这一帧符箓已经离开绿区
    expect(s.judgeNow()).not.toBe('perfect');
    const r = s.throwAt(tp)!; // 但触摸发生在 tp
    expect(r.judge).toBe('perfect');
    expect(r.seal).toBe(true);
  });

  it('拍满 3 张后结束，印数 = 完美次数', () => {
    const s = new RevealSession(cfg.reveal, beast('lei'), { rng: new Rng(8) });
    s.throwAt(10);
    s.throwAt(20);
    s.throwAt(30);
    expect(s.done).toBe(true);
    expect(s.throwAt(40)).toBeNull();
    expect(s.seals).toBe(s.throws.filter((t) => t.judge === 'perfect').length);
  });
});
