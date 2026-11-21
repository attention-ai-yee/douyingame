import { describe, expect, it } from 'vitest';
import { newBeastState, rarityAtLeast } from '../client/assets/scripts/core';
import { addBeast } from '../client/assets/scripts/core/systems/collection';
import { makeCore } from './helpers';

describe('进山抽兽', () => {
  it('未解锁的山不能抽；进山符不够时不能抽', () => {
    const { core } = makeCore();
    expect(core.pull('xishan', 1)).toMatchObject({ ok: false, reason: 'locked' });
    expect(core.pull('nanshan', 1)).toMatchObject({ ok: false, reason: 'tickets' });
  });

  it('每天第一次十连免费，第二次扣进山符', () => {
    const { core } = makeCore();
    expect(core.pull('nanshan', 10).ok).toBe(true);
    expect(core.pull('nanshan', 10)).toMatchObject({ ok: false, reason: 'tickets' });
    core.grantTickets(10);
    expect(core.pull('nanshan', 10).ok).toBe(true);
    expect(core.state.tickets).toBe(0);
  });

  it('稀有及以上进入现身拍符队列，结算后出队', () => {
    const { core } = makeCore({ seed: 7 });
    core.state.stage = 120; // 所有山都是秘境，稀有率最高
    core.grantTickets(200);
    const res = core.pull('beidongzhong', 200).results;
    const rare = res.filter((r) => rarityAtLeast(r.rarity, 'xi'));
    expect(rare.length).toBeGreaterThan(0);
    expect(core.revealQueue.length).toBe(rare.length);
    const p = core.revealQueue[0];
    const shardsBefore = core.state.beasts[p.beastId].shards;
    const reward = core.finishReveal(p, 3);
    expect(reward.shards).toBeGreaterThanOrEqual(1);
    expect(core.state.beasts[p.beastId].shards).toBe(shardsBefore + reward.shards);
    expect(core.revealQueue.length).toBe(rare.length - 1);
  });

  it('保底：连续 30 抽必出稀有，连续 90 抽必出传说；十连至少一只灵', () => {
    const { core } = makeCore({ seed: 11 });
    core.state.stage = 0; // 南山浅山：传说概率 0，只能靠保底
    let sinceXi = 0;
    let sinceCs = 0;
    let maxGapXi = 0;
    let maxGapCs = 0;
    let legends = 0;
    for (let k = 0; k < 300; k++) {
      core.grantTickets(10);
      core.state.daily.freeTenPullsUsed = 99;
      const res = core.pull('nanshan', 10).results;
      expect(res.some((r) => rarityAtLeast(r.rarity, 'ling'))).toBe(true);
      for (const r of res) {
        sinceXi++;
        sinceCs++;
        if (rarityAtLeast(r.rarity, 'xi')) {
          maxGapXi = Math.max(maxGapXi, sinceXi);
          sinceXi = 0;
        }
        if (r.rarity === 'chuanshuo') {
          legends++;
          maxGapCs = Math.max(maxGapCs, sinceCs);
          sinceCs = 0;
        }
      }
    }
    expect(maxGapXi).toBeLessThanOrEqual(30);
    expect(maxGapCs).toBe(90); // 浅山没有自然传说，全靠保底
    expect(legends).toBe(Math.floor(3000 / 90));
  });

  it('秘境大样本概率接近配置（47/38/12/3）', () => {
    const { core } = makeCore({ seed: 99 });
    core.state.stage = 40;
    core.grantTickets(20000);
    const res = core.pull('nanshan', 20000).results;
    const share = (r: string) => res.filter((x) => x.rarity === r).length / res.length;
    expect(share('fan')).toBeCloseTo(0.47, 1);
    expect(share('ling')).toBeCloseTo(0.38, 1);
    expect(share('xi')).toBeGreaterThan(0.11);
    expect(share('chuanshuo')).toBeGreaterThan(0.028);
  });

  it('重复获得转星魄，闪光重复给 2 个；升星优先用自己的星魄，不够再用万能星魄', () => {
    const { core, clock } = makeCore();
    const ctx = { idx: core.idx, f: core.f, s: core.state, rng: core.rng, now: clock.now() };
    expect(addBeast(ctx, 'lei').shardsGained).toBe(1);
    const shinyDup = addBeast(ctx, 'lei', { shiny: true });
    expect(shinyDup.shardsGained).toBe(2);
    expect(shinyDup.newShiny).toBe(true);
    expect(core.state.beasts.lei.shards).toBe(3);
    expect(core.starUp('lei')).toBe(true); // 1→2 星消耗 2
    expect(core.state.beasts.lei.shards).toBe(1);
    expect(core.starUp('lei')).toBe(false); // 2→3 需要 4，自己只有 1
    core.state.wildShards.fan = 3;
    expect(core.starUp('lei', true)).toBe(true);
    expect(core.state.beasts.lei).toMatchObject({ star: 3, shards: 0 });
    expect(core.state.wildShards.fan).toBe(0);
  });

  it('熔炼：3 个星魄换 1 个高一档万能星魄，传说不能熔炼', () => {
    const { core } = makeCore();
    core.state.beasts.lei.shards = 7;
    expect(core.melt('lei', 4)).toBe(0); // 必须是 3 的倍数
    expect(core.melt('lei', 6)).toBe(2);
    expect(core.state.wildShards.ling).toBe(2);
    core.state.beasts.yinglong = newBeastState(0, { star: 5, shards: 9 });
    expect(core.melt('yinglong', 9)).toBe(0);
  });
});
