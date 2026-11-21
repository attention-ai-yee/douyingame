import { describe, expect, it } from 'vitest';
import { BeastDef, RevealSession, Rng, ZoneView } from '../client/assets/scripts/core';
import { arcPoints, inArc, polar, sealsText, VisualInput, visualState } from '../client/assets/scripts/view/reveal/RevealGeometry';
import { loadConfig } from './helpers';

const cfg = loadConfig();
const beast = (id: string): BeastDef => cfg.beasts.beasts.find((b) => b.id === id)!;
const zone = (center: number, half = 10): ZoneView => ({ center, halfPerfect: half, halfGood: half * 3, active: true });
const input = (o: Partial<VisualInput>): VisualInput => ({
  t: 0,
  markerAngle: 0,
  direction: 1,
  zones: [zone(180)],
  telegraph: null,
  radius: 200,
  lastThrowT: -Infinity,
  isStruggleThrow: false,
  ...o,
});

describe('拍符界面：几何', () => {
  it('0° 在正上方，顺时针为正（Cocos 坐标 y 朝上）', () => {
    const top = polar(0, 100);
    const right = polar(90, 100);
    const bottom = polar(180, 100);
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(100, 6);
    expect(right.x).toBeCloseTo(100, 6);
    expect(right.y).toBeCloseTo(0, 6);
    expect(bottom.y).toBeCloseTo(-100, 6);
  });

  it('弧线取点覆盖整段弧', () => {
    const pts = arcPoints(90, 20, 100, 5);
    expect(pts.length).toBe(9);
    expect(pts[0].x).toBeCloseTo(polar(70, 100).x, 6);
    expect(pts[pts.length - 1].y).toBeCloseTo(polar(110, 100).y, 6);
  });

  it('跨 0° 的弧也能判断', () => {
    expect(inArc(355, 5, 15)).toBe(true);
    expect(inArc(30, 5, 15)).toBe(false);
  });

  it('印章显示', () => {
    expect(sealsText(2, 3)).toBe('●●○');
  });
});

describe('拍符界面：视觉效果（只影响表现，不影响判定）', () => {
  it('猾褢：每 1.5 秒缩回洞里 0.5 秒，快出来时提示"探头"', () => {
    const b = beast('huahuai').reveal;
    expect(visualState(b, input({ t: 500 })).hidden).toBe(false);
    expect(visualState(b, input({ t: 1100 })).hidden).toBe(true);
    expect(visualState(b, input({ t: 1100 })).hint).toBeNull();
    expect(visualState(b, input({ t: 1300 })).hint).toBe('探头！');
    expect(visualState(b, input({ t: 1600 })).hidden).toBe(false);
  });

  it('夫诸：水位 4 秒内涨到一半，水下的符箓看不见', () => {
    const b = beast('fuzhu').reveal;
    expect(visualState(b, input({ t: 2000 })).waterLevel).toBeCloseTo(0.25, 6);
    expect(visualState(b, input({ t: 10000 })).waterLevel).toBeCloseTo(0.5, 6);
    expect(visualState(b, input({ t: 10000, markerAngle: 180 })).markerHidden).toBe(true);
    expect(visualState(b, input({ t: 10000, markerAngle: 0 })).markerHidden).toBe(false);
  });

  it('旋龟：龟壳挡在符箓来的方向，紧挨着判定区', () => {
    const b = beast('xuangui').reveal;
    const cw = visualState(b, input({ direction: 1, zones: [zone(180, 10)], markerAngle: 130 }));
    expect(cw.occluder!.center).toBeCloseTo(180 - (30 + 30), 6);
    expect(cw.markerHidden).toBe(true);
    const ccw = visualState(b, input({ direction: -1, zones: [zone(180, 10)], markerAngle: 130 }));
    expect(ccw.markerHidden).toBe(false);
  });

  it('帝江：绿区一闪一闪', () => {
    const b = beast('dijiang').reveal;
    expect(visualState(b, input({ t: 0 })).zoneAlpha).toBeCloseTo(1, 6);
    expect(visualState(b, input({ t: 400 })).zoneAlpha).toBeCloseTo(0.2, 6);
  });

  it('鸾鸟：五采色段包含当前绿区的位置', () => {
    const b = beast('luanniao').reveal;
    const v = visualState(b, input({ zones: [zone(100)] }));
    expect(v.rainbow!.length).toBe(5);
    expect(v.rainbow![0]).toBe(100);
  });

  it('当康：绿区快跳时喊"当康！"；传说最后一拍提示挣脱', () => {
    expect(visualState(beast('dangkang').reveal, input({ telegraph: { kind: 'jump', inMs: 100 } })).hint).toBe('当康！');
    expect(visualState(beast('lei').reveal, input({ isStruggleThrow: true })).hint).toBe('它要挣脱了！');
  });

  it('和真实 RevealSession 对接：数据都能取到', () => {
    const s = new RevealSession(cfg.reveal, beast('fenghuang'), { rng: new Rng(1) });
    s.advance(1500);
    const v = visualState(beast('fenghuang').reveal, {
      t: s.elapsed,
      markerAngle: s.markerAngle,
      direction: s.direction,
      zones: s.zones(),
      telegraph: s.telegraph(),
      radius: 220,
      lastThrowT: -Infinity,
      isStruggleThrow: s.isStruggleThrow,
    });
    expect(v.hint).toBe('↺ 要转向了'); // 凤皇 1.6 秒反向，提前 0.4 秒预告
  });
});
