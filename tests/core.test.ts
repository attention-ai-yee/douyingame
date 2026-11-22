import { describe, expect, it } from 'vitest';
import { GameCore, migrate, newBeastState, SAVE_VERSION } from '../client/assets/scripts/core';
import { DAY, HOUR, loadConfig, makeCore, MIN } from './helpers';

describe('挂机宝箱', () => {
  it('在线挂机：产出先进宝箱，点领取才到手；经验是金币的一半', () => {
    const { core, clock } = makeCore();
    core.resume();
    for (let i = 0; i < 60; i++) {
      clock.advance(1000);
      core.tick();
    }
    expect(core.state.gold).toBe(0);
    expect(core.state.chest.gold).toBeCloseTo(core.goldPerMin(), 6); // 1 分钟
    expect(core.state.chest.exp).toBeCloseTo(core.goldPerMin() * 0.5, 6);
    const got = core.claimChest();
    expect(core.state.gold).toBeCloseTo(got.gold, 6);
    expect(core.state.exp).toBeCloseTo(got.exp, 6);
    expect(core.chestEmpty()).toBe(true);
  });

  it('离线按 60% 攒进宝箱，最多 8 小时；看广告金币经验翻倍', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(10 * HOUR);
    const res = core.resume();
    expect(res.ms).toBe(8 * HOUR);
    expect(core.chestFull()).toBe(true);
    const gold = core.goldPerMin() * 8 * 60 * 0.6;
    expect(core.state.chest.gold).toBeCloseTo(gold, 6);
    // 装备每 15 分钟（折算后）1 件，寻兽符每 3 小时 1 张，凡级万能星魄每 4 小时 1 个
    expect(core.state.chest.items.length).toBe(Math.floor((8 * 60 * 0.6) / 15));
    expect(core.state.chest.tickets).toBe(1);
    expect(core.state.chest.fanShards).toBe(1);
    const got = core.claimChest(2);
    expect(got.gold).toBeCloseTo(gold * 2, 6);
    expect(core.state.bag.length).toBe(got.items.length);
    expect(core.state.tickets).toBe(1);
    expect(core.state.wildShards.fan).toBe(1);
  });

  it('宝箱满了不再增加，领取后重新开始攒', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(9 * HOUR);
    core.resume();
    const full = core.state.chest.gold;
    clock.advance(60 * 1000);
    core.tick();
    expect(core.state.chest.gold).toBe(full);
    core.claimChest();
    clock.advance(60 * 1000);
    core.tick();
    expect(core.state.chest.gold).toBeCloseTo(core.goldPerMin(), 6);
  });

  it('系统时间被往回调时，宝箱不增加', () => {
    const { core, clock } = makeCore();
    core.resume();
    core.pause();
    clock.advance(-3 * HOUR);
    const res = core.resume();
    expect(res.clockRollback).toBe(true);
    expect(core.state.chest.gold).toBe(0);
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

describe('异兽升级与装备', () => {
  it('升级花金币和经验，经验不够就升不了', () => {
    const { core } = makeCore();
    core.state.gold = 1000;
    core.state.exp = 0;
    expect(core.levelUp('lei')).toBe(0);
    core.state.exp = 5;
    expect(core.levelUp('lei')).toBe(1);
    expect(core.state.beasts.lei.level).toBe(2);
    expect(core.state.gold).toBe(990);
    expect(core.state.exp).toBe(0);
  });

  it('一键升级轮流给上阵异兽里等级最低的升级', () => {
    const { core } = makeCore();
    core.state.beasts.lushu = newBeastState(0);
    core.state.beasts.huahuai = newBeastState(0, { level: 5 });
    core.state.team = ['lei', 'lushu', 'huahuai', null, null];
    core.state.gold = 25;
    core.state.exp = 1000;
    core.upgradeTeam();
    expect(['lei', 'lushu', 'huahuai'].map((id) => core.state.beasts[id].level)).toEqual([2, 2, 5]);
  });

  it('重置：回到 1 级，金币和经验全额返还，装备卸到背包', () => {
    const { core } = makeCore();
    core.state.gold = 1e6;
    core.state.exp = 1e6;
    core.levelUp('lei', 30);
    core.state.bag.push({ id: 99, slot: 0, q: 'xi', tier: 1 });
    core.equip('lei', 99);
    const r = core.resetBeast('lei')!;
    expect(core.state.beasts.lei.level).toBe(1);
    expect(core.state.gold).toBeCloseTo(1e6, 4);
    expect(core.state.exp).toBeCloseTo(1e6, 4);
    expect(r.items).toBe(1);
    expect(core.state.bag.map((x) => x.id)).toEqual([99]);
  });

  it('装备加战力：一键穿戴挑更好的，旧的回背包；一键分解只留稀有以上', () => {
    const { core } = makeCore();
    const p0 = core.unitPower('lei');
    core.state.bag.push({ id: 1, slot: 0, q: 'fan', tier: 1 }, { id: 2, slot: 0, q: 'ling', tier: 1 }, { id: 3, slot: 1, q: 'xi', tier: 1 });
    expect(core.hasEquipUpgrade()).toBe(true);
    expect(core.equipBest()).toBe(2);
    expect(core.state.beasts.lei.equip[0]!.id).toBe(2);
    expect(core.state.beasts.lei.equip[1]!.id).toBe(3);
    expect(core.unitPower('lei')).toBeCloseTo(p0 * Math.sqrt(1.04 * 1.07), 6);
    expect(core.state.bag.map((x) => x.id)).toEqual([1]);
    const d = core.dismantleBag('xi');
    expect(d.count).toBe(1);
    expect(d.gold).toBeGreaterThan(0);
    expect(core.state.bag.length).toBe(0);
  });

  it('装备的阶随进度提高，数值按阶增长', () => {
    const { core } = makeCore();
    expect(core.f.itemTier(40)).toBe(1);
    expect(core.f.itemTier(41)).toBe(2);
    expect(core.f.itemPct('chuanshuo', 3)).toBeCloseTo(0.12 * 2, 9);
  });
});

describe('闯关、阵位、镇妖塔', () => {
  it('挂机不会自己推关：只有主动挑战才会过关', () => {
    const { core, clock } = makeCore();
    core.resume();
    for (let i = 0; i < 600; i++) {
      clock.advance(1000);
      core.tick();
    }
    expect(core.state.stage).toBe(0);
  });

  it('升级后能闯过前几关，首通给金币和经验', () => {
    const { core } = makeCore();
    core.state.gold = 5000;
    core.state.exp = 5000;
    core.upgradeTeam();
    core.state.gold = 0;
    core.state.exp = 0;
    let wins = 0;
    for (let i = 0; i < 5; i++) if (core.challengeStage().win) wins++;
    expect(wins).toBeGreaterThan(0);
    expect(core.state.stage).toBe(wins);
    expect(core.state.gold).toBeGreaterThan(0);
    expect(core.state.exp).toBeCloseTo(core.state.gold * 0.5, 6);
  });

  it('小 Boss 首通必掉灵级以上装备', () => {
    const { core } = makeCore();
    core.state.stage = 9;
    core.state.beasts.lei.level = 200;
    const r = core.challengeStage();
    expect(r.win).toBe(true);
    expect(core.state.bag.length).toBe(1);
    expect(['ling', 'xi', 'chuanshuo']).toContain(core.state.bag[0].q);
  });

  it('空阵位自动补上新异兽，已上阵的不动', () => {
    const { core } = makeCore();
    core.state.beasts.jiuweihu = newBeastState(0);
    core.state.beasts.lushu = newBeastState(0);
    expect(core.fillEmptySlots()).toBe(2);
    expect(core.state.team.slice(0, 3)).toEqual(['lei', 'jiuweihu', 'lushu']);
    expect(core.fillEmptySlots()).toBe(0);
  });

  it('第 10 关开第 4 阵位；第 40 关开第 5 阵位并解锁镇妖塔', () => {
    const { core } = makeCore();
    core.state.stage = 9;
    core.state.beasts.lei.level = 200;
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
    core.state.beasts.lei.level = 400;
    for (let i = 0; i < 10; i++) expect(core.challengeFloor().win).toBe(true);
    expect(core.state.floor).toBe(10);
    expect(core.state.tickets).toBe(4);
    expect(core.state.wildShards.ling).toBe(1);
  });

  it('第 2 章 Boss 陆吾首次击败必定收服，并进入 Boss 拍符', () => {
    const { core } = makeCore();
    core.state.stage = 79;
    core.state.beasts.lei.level = 600;
    expect(core.challengeStage().win).toBe(true);
    expect(core.state.beasts.luwu).toBeDefined();
    const p = core.revealQueue.find((r) => r.beastId === 'luwu')!;
    expect(p.isBoss).toBe(true);
  });

  it('新手关：只有一只 1 级的"类"也能连过第 1～3 关', () => {
    const { core } = makeCore();
    expect(core.challengeStage().win).toBe(true);
    core.upgradeTeam();
    expect(core.challengeStage().win).toBe(true);
    core.upgradeTeam();
    expect(core.challengeStage().win).toBe(true);
    expect(core.state.stage).toBe(3);
  });

  it('助战：本场战力 ×1.3，每天 5 次', () => {
    const { core } = makeCore();
    core.state.stage = 10;
    const enemy = core.nextStage()!.enemyPower;
    const power = core.teamPower();
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
    const s = migrate({ v: 2, gold: 7, beasts: { lei: { star: 2, shards: 1, awaken: 0, shiny: false, obtainedAt: 0 } } }, now, 1)!;
    expect(s.gold).toBe(7);
    expect(s.exp).toBe(0);
    expect(s.daily.freeTenPullsUsed).toBe(0);
    expect(s.beasts.lei.star).toBe(2);
    expect(s.beasts.lei.level).toBe(1);
    expect(s.beasts.lei.equip).toEqual([null, null, null, null]);
    expect(migrate({ v: SAVE_VERSION + 1 }, now, 1)).toBeNull();
    expect(GameCore.loadState('{坏掉的存档', now, 1).v).toBe(SAVE_VERSION);
  });
});

describe('五行羁绊', () => {
  it('同系 2 只 +10%，4 只再 +15%；有可凑羁绊的异兽时给提示', () => {
    const { core } = makeCore();
    core.state.beasts.huahuai = newBeastState(0);
    core.state.beasts.huan = newBeastState(0);
    core.state.beasts.bifang = newBeastState(0);
    core.state.team = ['huahuai', 'lei', null, null, null];
    let s = core.synergies();
    expect(s.active).toEqual([]);
    expect(s.hint).toContain('火·燎原');
    core.state.team = ['huahuai', 'huan', 'lei', null, null];
    s = core.synergies();
    expect(s.active).toEqual([{ element: 'huo', count: 2, bonus: 0.1 }]);
    core.state.stage = 10; // 开第 4 阵位
    core.state.team = ['huahuai', 'huan', 'bifang', 'lei', null];
    expect(core.synergies().active[0].count).toBe(3);
  });
});

describe('每日任务', () => {
  it('挑战、寻兽、升级、领宝箱、看视频计数；每项领寻兽符，全部完成再领金币经验；跨天重置', () => {
    const { core, clock } = makeCore();
    core.resume();
    const byId = () => Object.fromEntries(core.dailyTasks().map((t) => [t.id, t]));
    core.challengeStage();
    core.challengeStage();
    core.challengeStage(); // 输赢都算
    core.pull('nanshan', 10);
    core.state.gold = 1e6;
    core.state.exp = 1e6;
    core.levelUp('lei', 10);
    clock.advance(60 * 1000);
    core.tick();
    core.claimChest();
    let t = byId();
    expect([t.challenge.done, t.pull.done, t.levelup.done, t.chest.done, t.ads.done]).toEqual([true, true, true, true, false]);
    expect(core.hasTaskReward()).toBe(true);
    const before = core.state.tickets;
    for (const id of ['challenge', 'pull', 'levelup', 'chest'] as const) expect(core.claimTask(id)).toBe(1);
    expect(core.claimTask('challenge')).toBe(0); // 不能重复领
    expect(core.state.tickets).toBe(before + 4);
    expect(core.canClaimAllTasks()).toBe(false);
    for (let i = 0; i < 3; i++) core.recordAdWatched();
    expect(core.claimTask('ads')).toBe(1);
    const g = core.state.gold;
    const r = core.claimAllTasks()!;
    expect(r.gold).toBeCloseTo(core.goldPerMin() * 30, 6);
    expect(core.state.gold).toBeCloseTo(g + r.gold, 6);
    expect(core.claimAllTasks()).toBeNull();
    clock.advance(DAY);
    core.tick();
    t = byId();
    expect(t.challenge.progress).toBe(0);
    expect(t.challenge.claimed).toBe(false);
  });
});

describe('新手引导', () => {
  it('签到 → 领宝箱 → 升级 → 闯第 1 关 → 寻兽，按顺序前进；领签到后宝箱里多放一份新手奖励', () => {
    const { core } = makeCore();
    core.resume();
    expect(core.tutorialStep()).toBe('signin');
    core.claimChest(); // 不按顺序的操作不会前进
    expect(core.tutorialStep()).toBe('signin');
    core.claimSignin();
    expect(core.tutorialStep()).toBe('chest');
    expect(core.state.chest.gold).toBeGreaterThan(0);
    expect(core.state.chest.items.length).toBe(2);
    expect(core.state.chest.items[0].q).not.toBe('fan');
    core.claimChest();
    expect(core.tutorialStep()).toBe('upgrade');
    expect(core.upgradeTeam()).toBeGreaterThan(0); // 新手宝箱够升好几级
    expect(core.tutorialStep()).toBe('stage');
    expect(core.challengeStage().win).toBe(true);
    expect(core.tutorialStep()).toBe('summon');
    core.pull('nanshan', 10);
    expect(core.tutorialStep()).toBeNull();
    expect(core.state.tutorial.done).toBe(true);
  });

  it('先打了第 1 关、没有免费十连也没有寻兽符时自动跳过对应步骤；可以手动跳过', () => {
    const { core } = makeCore();
    core.state.tutorial.step = 3; // stage
    core.state.stage = 1;
    core.state.daily.freeTenPullsUsed = 1;
    core.state.daily.dayKey = 'x';
    expect(core.tutorialStep()).not.toBe('stage');
    const { core: c2 } = makeCore();
    c2.skipTutorial();
    expect(c2.tutorialStep()).toBeNull();
  });

  it('老存档（已经打了几关）直接视为完成引导', () => {
    const { core, clock } = makeCore();
    core.state.stage = 9;
    const state = GameCore.loadState(core.serialize(), clock.now(), 1);
    const core2 = new GameCore(loadConfig(), { clock: clock.now, state });
    expect(core2.tutorialStep()).toBeNull();
  });
});

describe('存档升级 v1 → v2', () => {
  it('阵位等级挪到所在阵位的异兽身上，离线收益并进宝箱', () => {
    const v1 = {
      v: 1,
      gold: 5,
      team: ['lei', 'lushu', null, null, null],
      slotLevels: [12, 7, 3, 1, 1],
      beasts: {
        lei: { star: 1, shards: 0, awaken: 0, shiny: false, obtainedAt: 0 },
        lushu: { star: 1, shards: 0, awaken: 0, shiny: false, obtainedAt: 0 },
        huan: { star: 1, shards: 0, awaken: 0, shiny: false, obtainedAt: 0 },
      },
      pendingOffline: { ms: 3600e3, gold: 500 },
    };
    const s = migrate(v1, Date.now(), 1)!;
    expect(s.v).toBe(SAVE_VERSION);
    expect([s.beasts.lei.level, s.beasts.lushu.level, s.beasts.huan.level]).toEqual([12, 7, 1]);
    expect(s.chest.gold).toBe(500);
    expect('slotLevels' in s).toBe(false);
    expect('pendingOffline' in s).toBe(false);
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
        core.claimChest(1);
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
          core.claimChest(1);
          core.equipBest();
          core.upgradeTeam();
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
