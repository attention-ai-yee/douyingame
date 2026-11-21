import { describe, expect, it } from 'vitest';
import { Rng } from '../client/assets/scripts/core';
import { BattleSim } from '../client/assets/scripts/view/main/BattleSim';

function run(o: { allyPowers: number[]; enemyCount: number; enemyPower: number; win: boolean; seed: number }) {
  const r = new Rng(o.seed);
  const sim = new BattleSim({ ...o, rng: () => r.next() });
  const events = [];
  while (!sim.done && sim.t < 60000) events.push(...sim.step(16));
  return { sim, events };
}

describe('主界面战斗演出', () => {
  it('core 判定赢：敌人全倒、我方没有全倒，时长在预计范围内', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { sim, events } = run({ allyPowers: [300, 250, 200], enemyCount: 3, enemyPower: 700, win: true, seed });
      expect(sim.done).toBe(true);
      expect(sim.enemies.every((u) => !u.alive)).toBe(true);
      expect(sim.allies.some((u) => u.alive)).toBe(true);
      expect(sim.t).toBeLessThan(sim.targetMs * 1.6);
      expect(sim.t).toBeGreaterThan(sim.targetMs * 0.6);
      expect(events.every((e) => e.dmg >= 0)).toBe(true);
    }
  });

  it('core 判定输：我方全倒、敌人没有全倒', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { sim } = run({ allyPowers: [300, 250, 200], enemyCount: 1, enemyPower: 2000, win: false, seed });
      expect(sim.allies.every((u) => !u.alive)).toBe(true);
      expect(sim.enemies.some((u) => u.alive)).toBe(true);
    }
  });

  it('战力碾压时打得快，势均力敌时打得慢', () => {
    const easy = run({ allyPowers: [1000, 1000, 1000], enemyCount: 3, enemyPower: 300, win: true, seed: 3 }).sim;
    const hard = run({ allyPowers: [1000, 1000, 1000], enemyCount: 3, enemyPower: 2900, win: true, seed: 3 }).sim;
    expect(easy.t).toBeLessThan(hard.t);
    expect(easy.targetMs).toBeLessThan(4000); // 3000 + 6000 × 300 / 3000 = 3600ms
  });

  it('伤害数字和战力同一量级，有暴击', () => {
    const { events } = run({ allyPowers: [8000, 8000], enemyCount: 2, enemyPower: 12000, win: true, seed: 9 });
    const ally = events.filter((e) => e.side === 'ally');
    expect(ally.length).toBeGreaterThan(5);
    expect(ally.some((e) => e.crit)).toBe(true);
    expect(Math.max(...ally.map((e) => e.dmg))).toBeGreaterThan(800);
  });
});
