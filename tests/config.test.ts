import { describe, expect, it } from 'vitest';
import { validateConfig } from '../client/assets/scripts/core';
import { cloneConfig, loadConfig } from './helpers';

describe('配置校验', () => {
  it('仓库里的配置表通过全部校验', () => {
    expect(validateConfig(loadConfig())).toEqual([]);
  });

  it('20 只异兽，稀有度 6/7/5/2，五行各 4 只', () => {
    const b = loadConfig().beasts.beasts;
    expect(b.length).toBe(20);
    const count = (k: 'rarity' | 'element', v: string) => b.filter((x) => x[k] === v).length;
    expect([count('rarity', 'fan'), count('rarity', 'ling'), count('rarity', 'xi'), count('rarity', 'chuanshuo')]).toEqual([6, 7, 5, 2]);
    for (const e of ['mu', 'huo', 'tu', 'jin', 'shui']) expect(count('element', e)).toBe(4);
  });

  it('兽池某档为空时报错', () => {
    const cfg = cloneConfig();
    cfg.pools.mountains[0].tiers.xi = [];
    expect(validateConfig(cfg).join('\n')).toContain('nanshan 的 xi 档为空');
  });

  it('兽池里的稀有度和异兽不符时报错', () => {
    const cfg = cloneConfig();
    cfg.pools.mountains[0].tiers.fan.push(['jiuweihu', 1]);
    expect(validateConfig(cfg).join('\n')).toContain('jiuweihu 的稀有度是 xi');
  });

  it('探索度概率之和不是 100% 时报错', () => {
    const cfg = cloneConfig();
    cfg.pools.depths.deep.rates.fan = 0.6;
    expect(validateConfig(cfg).join('\n')).toContain('探索度 deep 概率之和');
  });

  it('完美区低于 70ms 时报错（例如把九尾狐的绿区缩得太小）', () => {
    const cfg = cloneConfig();
    const fox = cfg.beasts.beasts.find((b) => b.id === 'jiuweihu')!;
    fox.reveal.zones!.sizeFactor = 0.5;
    expect(validateConfig(cfg).join('\n')).toContain('九尾狐 的完美区只有');
  });

  it('Boss 收服的异兽会扣掉 bossPerfectMinusMs 再检查', () => {
    const cfg = cloneConfig();
    cfg.reveal.rarity.xi.perfectMs = 75; // 陆吾是 Boss：75 - 10 = 65 < 70
    const errs = validateConfig(cfg).join('\n');
    expect(errs).toContain('陆吾 的完美区');
    expect(errs).not.toContain('鸾鸟 的完美区');
  });

  it('敌人增长分段不连续时报错', () => {
    const cfg = cloneConfig();
    cfg.stages.enemy.segments[1].from = 22;
    expect(validateConfig(cfg).join('\n')).toContain('不连续');
  });
});
