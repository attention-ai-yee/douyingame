import { describe, expect, it } from 'vitest';
import { GameCore, migrate, SAVE_VERSION } from '../client/assets/scripts/core';
import { DAY, HOUR, loadConfig, makeCore, MIN } from './helpers';

describe('挂机与离线', () => {
  it('在线时按真实时间累计金币', () => {
    const { core, clock } = makeCore();
    core.resume();
    for (let i = 0; i < 60; i++) {
      clock.advance(1000);
      core.tick();
    }
    expect(core.state.gold).toBeCloseTo(core.goldPerMin(), 6); // 1 分钟
  });

  it('离线收益 = 60% × 挂机效率，上限 8 小时，看广告可翻倍', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(10 * HOUR);
    const res = core.resume();
    expect(res.ms).toBe(8 * HOUR);
    expect(res.gold).toBeCloseTo(core.goldPerMin() * 8 * 60 * 0.6, 6);
    expect(core.state.pendingOffline).not.toBeNull();
    const got = core.claimOffline(2);
    expect(got).toBeCloseTo(res.gold * 2, 6);
    expect(core.state.pendingOffline).toBeNull();
  });

  it('系统时间被往回调时，离线收益为 0', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(-3 * HOUR);
    const res = core.resume();
    expect(res.clockRollback).toBe(true);
    expect(res.gold).toBe(0);
  });

  it('离线每 2 小时累积 1 次野遇，最多 3 次；领取时受每日 5 次上限约束', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(7 * HOUR);
    core.resume();
    expect(core.state.wildStore).toBe(3);
    const got = core.claimStoredWild();
    expect(got.length).toBe(3);
    expect(core.revealQueue.length).toBe(3); // 野遇所有稀有度都要拍符
    expect(core.state.daily.wildEncounters).toBe(3);
  });

  it('跨天重置每日次数', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pull('nanshan', 10);
    expect(core.canFreeTenPull()).toBe(false);
    clock.advance(DAY);
    core.tick(); // 超过 2 分钟没有 tick，按离线 + 跨天处理
    expect(core.canFreeTenPull()).toBe(true);
  });
});

describe('推图、阵位、镇妖塔', () => {
  it('升级阵位后能推过前几关，首通给金币', () => {
    const { core } = makeCore();
    core.state.gold = 5000;
    core.upgradeCheapest();
    let wins = 0;
    for (let i = 0; i < 5; i++) if (core.challengeStage().win) wins++;
    expect(wins).toBeGreaterThan(0);
    expect(core.state.stage).toBe(wins);
  });

  it('一键升级优先升最便宜的阵位', () => {
    const { core } = makeCore();
    core.state.slotLevels = [5, 1, 1, 1, 1];
    core.state.gold = 25;
    core.upgradeCheapest();
    expect(core.state.slotLevels.slice(0, 3)).toEqual([5, 2, 2]);
  });

  it('第 10 关开第 4 阵位；第 40 关开第 5 阵位并解锁镇妖塔', () => {
    const { core } = makeCore();
    core.state.stage = 9;
    core.state.gold = 1e9;
    core.upgradeCheapest();
    core.autoTeam();
    expect(core.challengeStage().win).toBe(true);
    expect(core.slotsAvailable()).toBe(4);
    core.state.stage = 39;
    expect(core.towerUnlocked()).toBe(false);
    expect(core.challengeStage().win).toBe(true);
    expect(core.slotsAvailable()).toBe(5);
    expect(core.towerUnlocked()).toBe(true);
    expect(core.state.tickets).toBeGreaterThanOrEqual(13); // 小 Boss 3 + 章节 Boss 10
  });

  it('镇妖塔每 5 层给进山符、每 10 层给灵级万能星魄', () => {
    const { core } = makeCore();
    core.state.stage = 40;
    core.state.gold = 1e12;
    core.upgradeCheapest();
    for (let i = 0; i < 10; i++) expect(core.challengeFloor().win).toBe(true);
    expect(core.state.floor).toBe(10);
    expect(core.state.tickets).toBe(4);
    expect(core.state.wildShards.ling).toBe(1);
  });

  it('第 2 章 Boss 陆吾首次击败必定收服，并进入 Boss 拍符', () => {
    const { core } = makeCore();
    core.state.stage = 79;
    core.state.gold = 1e15;
    core.upgradeCheapest();
    expect(core.challengeStage().win).toBe(true);
    expect(core.state.beasts.luwu).toBeDefined();
    const p = core.revealQueue.find((r) => r.beastId === 'luwu')!;
    expect(p.isBoss).toBe(true);
  });

  it('新手关：只有一只 1 级的"类"也能连过第 1～3 关', () => {
    const { core } = makeCore();
    expect(core.challengeStage().win).toBe(true);
    core.upgradeCheapest();
    expect(core.challengeStage().win).toBe(true);
    core.upgradeCheapest();
    expect(core.challengeStage().win).toBe(true);
    expect(core.state.stage).toBe(3);
  });

  it('助战：本场战力 ×1.3，每天 5 次', () => {
    const { core } = makeCore();
    core.state.stage = 10;
    const enemy = core.nextStage()!.enemyPower;
    const power = core.teamPower();
    core.state.slotLevels = [1, 1, 1, 1, 1];
    expect(power).toBeLessThan(enemy);
    for (let i = 0; i < 5; i++) core.challengeStage(true);
    expect(core.state.daily.assistsUsed).toBe(5);
    core.challengeStage(true);
    expect(core.state.daily.assistsUsed).toBe(5);
  });
});

describe('签到', () => {
  it('第 1 天九尾狐（稀有，进入拍符），第 3 天必须选自选兽，断签只顺延', () => {
    const { core, clock } = makeCore();
    core.resume();
    expect(core.claimSignin()!.beastId).toBe('jiuweihu');
    expect(core.revealQueue.some((p) => p.beastId === 'jiuweihu' && p.source === 'signin')).toBe(true);
    expect(core.claimSignin()).toBeNull(); // 同一天不能领两次
    clock.advance(DAY);
    core.tick();
    expect(core.claimSignin()!.reward.tickets).toBe(10);
    clock.advance(5 * DAY); // 断签 4 天
    core.tick();
    expect(core.claimSignin()).toBeNull(); // 第 3 天是自选，没选不发
    expect(core.claimSignin('dijiang')!.beastId).toBe('dijiang');
  });
});

describe('存档', () => {
  it('序列化后能原样恢复', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pull('nanshan', 10);
    core.state.gold = 12345;
    const raw = core.serialize();
    const state = GameCore.loadState(raw, clock.now(), 1);
    const core2 = new GameCore(loadConfig(), { clock: clock.now, state });
    expect(core2.state.gold).toBe(12345);
    expect(Object.keys(core2.state.beasts).sort()).toEqual(Object.keys(core.state.beasts).sort());
    expect(core2.rng.state).toBe(core.rng.state);
  });

  it('旧存档缺字段时用默认值补齐；更新版本的存档不读', () => {
    const now = Date.now();
    const s = migrate({ v: 1, gold: 7, beasts: { lei: { star: 2, shards: 1, awaken: 0, shiny: false, obtainedAt: 0 } } }, now, 1)!;
    expect(s.gold).toBe(7);
    expect(s.slotLevels).toEqual([1, 1, 1, 1, 1]);
    expect(s.daily.freeTenPullsUsed).toBe(0);
    expect(s.beasts.lei.star).toBe(2);
    expect(migrate({ v: SAVE_VERSION + 1 }, now, 1)).toBeNull();
    expect(GameCore.loadState('{坏掉的存档', now, 1).v).toBe(SAVE_VERSION);
  });
});

describe('冒烟：用 GameCore 玩 3 天', () => {
  it('不报错，并且推进速度和模拟器同一量级', () => {
    const { core, clock } = makeCore({ seed: 5 });
    core.resume();
    core.claimSignin();
    for (let day = 1; day <= 3; day++) {
      for (const sessionMin of [6, 8, 12, 6]) {
        core.resume();
        core.claimOffline(1);
        core.claimStoredWild();
        if (core.canClaimSignin()) core.claimSignin(core.idx.cfg.signin.firstRound[2].choice![0]);
        const mtn = core.mountains().filter((m) => m.unlocked).pop()!;
        if (core.canFreeTenPull()) core.pull(mtn.id, 10);
        if (core.state.tickets > 0) core.pull(mtn.id, core.state.tickets);
        while (core.revealQueue.length) core.finishReveal(core.revealQueue[0], 1);
        for (const id of Object.keys(core.state.beasts)) while (core.starUp(id, true));
        core.autoTeam();
        for (let m = 0; m < sessionMin; m++) {
          clock.advance(MIN);
          core.tick();
          core.upgradeCheapest();
          while (core.challengeStage().win);
          if (core.towerUnlocked()) while (core.challengeFloor().win);
        }
        core.pause();
        clock.advance(4 * HOUR);
      }
      clock.advance(DAY - 4 * (4 * HOUR) - 32 * MIN);
    }
    // 模拟器里不看广告的玩家第 3 天约第 39 关
    expect(core.state.stage).toBeGreaterThan(20);
    expect(core.state.stage).toBeLessThanOrEqual(60);
    expect(Object.keys(core.state.beasts).length).toBeGreaterThanOrEqual(6);
  });
});
