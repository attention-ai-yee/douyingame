import { execFileSync } from 'child_process';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { formatNumber, Formulas, indexConfig } from '../client/assets/scripts/core';
import { loadConfig } from './helpers';

const f = new Formulas(indexConfig(loadConfig()));

describe('数值公式（与游戏设计文档第 8 节、18.4 节的表一致）', () => {
  it('敌方战力', () => {
    expect(f.enemyPower(1)).toBe(450);
    expect(f.enemyPower(10)).toBeCloseTo(1756, -1);
    expect(f.enemyPower(40) / 1e4).toBeCloseTo(20.57, 0); // 文档：20.8 万
    expect(f.enemyPower(120) / 1e8).toBeCloseTo(3.5, 0);
    expect(f.isChapterBoss(40)).toBe(true);
    expect(f.isSmallBoss(40)).toBe(false);
    expect(f.isSmallBoss(30)).toBe(true);
    expect(f.isTreasure(15)).toBe(true);
    expect(f.isTreasure(20)).toBe(false);
  });

  it('挂机金币', () => {
    expect(f.goldPerMin(1)).toBe(20);
    expect(f.goldPerMin(120)).toBeCloseTo(62762, -2);
  });

  it('镇妖塔：约第 253 层强度等于第 120 关，等效关卡在边界处连续', () => {
    expect(f.towerFloorAtMainEnd).toBeGreaterThan(252);
    expect(f.towerFloorAtMainEnd).toBeLessThan(254);
    const b = f.towerFloorAtMainEnd;
    expect(f.towerEqStage(Math.floor(b))).toBeLessThanOrEqual(120.01);
    expect(f.towerEqStage(Math.ceil(b))).toBeGreaterThanOrEqual(119.99);
    expect(f.towerEqStage(Math.ceil(b) + 100) - f.towerEqStage(Math.ceil(b))).toBeCloseTo(45, 5);
    // 主线没打完时，塔的等效关卡和同强度主线关卡一致，不会额外加速主线
    expect(f.towerEqStage(1)).toBeCloseTo(40, 5);
  });

  it('阵位：开放数量、成本、系数', () => {
    expect(f.slotsAt(0)).toBe(3);
    expect(f.slotsAt(10)).toBe(4);
    expect(f.slotsAt(40)).toBe(5);
    expect(f.slotCost(1)).toBe(10);
    expect(f.slotMult(100)).toBeCloseTo(510, 0);
  });

  it('探索度', () => {
    expect(f.depthOf(1, 0)).toBe('shallow');
    expect(f.depthOf(1, 20)).toBe('deep');
    expect(f.depthOf(1, 40)).toBe('secret');
    expect(f.depthOf(2, 39)).toBeNull();
    expect(f.depthOf(2, 40)).toBe('shallow');
  });

  it('大数显示', () => {
    expect(formatNumber(9999)).toBe('9999');
    expect(formatNumber(12345)).toBe('1.23万');
    expect(formatNumber(3.5e8)).toBe('3.5亿');
    expect(formatNumber(7.4e12)).toBe('7.4兆');
  });
});

describe('和 Python 模拟器的公式一致', () => {
  it('同样的输入得到同样的数', () => {
    const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(join(__dirname, '..', 'tools', 'sim'))})
import sim
m = sim.Model(sim.load_config())
out = {
  "enemy": [m.enemy(n) for n in (1, 10, 39, 40, 79, 80, 120)],
  "tower": [m.tower_enemy(fl) for fl in (1, 10, 100, 400)],
  "towerEq": [m.tower_eq_stage(fl) for fl in (1, 50, 253, 300, 500)],
  "gold": [m.gold_per_min(x) for x in (1, 40.5, 120, 200)],
  "slot": [[m.slot_cost(l), m.slot_mult(l)] for l in (1, 50, 150)],
}
print(json.dumps(out))
`;
    const py = JSON.parse(execFileSync('python3', ['-I', '-c', script], { encoding: 'utf-8' }));
    const close = (a: number, b: number) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(1e-9);
    [1, 10, 39, 40, 79, 80, 120].forEach((n, i) => close(f.enemyPower(n), py.enemy[i]));
    [1, 10, 100, 400].forEach((fl, i) => close(f.towerPower(fl), py.tower[i]));
    [1, 50, 253, 300, 500].forEach((fl, i) => close(f.towerEqStage(fl), py.towerEq[i]));
    [1, 40.5, 120, 200].forEach((x, i) => close(f.goldPerMin(x), py.gold[i]));
    [1, 50, 150].forEach((l, i) => {
      close(f.slotCost(l), py.slot[i][0]);
      close(f.slotMult(l), py.slot[i][1]);
    });
  });
});
