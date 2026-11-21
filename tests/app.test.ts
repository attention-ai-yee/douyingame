import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { App } from '../client/assets/scripts/app/App';
import { CONFIG_FILES } from '../client/assets/scripts/core';
import { EventData, Platform } from '../client/assets/scripts/platform';
import { CONFIG_DIR, FakeClock, HOUR } from './helpers';

class MemPlatform implements Platform {
  readonly name = 'web' as const;
  store: Record<string, string> = {};
  events: string[] = [];
  show: (() => void)[] = [];
  hide: (() => void)[] = [];
  constructor(public clock: FakeClock) {}
  now = () => this.clock.now();
  perfNow = () => this.clock.now();
  lastTouchStartAt = () => null;
  randomSeed = () => 123;
  storageGet = (k: string) => (k in this.store ? this.store[k] : null);
  storageSet = (k: string, v: string) => void (this.store[k] = v);
  storageRemove = (k: string) => void delete this.store[k];
  onShow = (cb: () => void) => void this.show.push(cb);
  onHide = (cb: () => void) => void this.hide.push(cb);
  showRewardedVideo = async () => 'completed' as const;
  showInterstitial = async () => true;
  vibrateShort() {}
  reportEvent = (name: string, _d: EventData) => void this.events.push(name);
  query: Record<string, string> = {};
  launchInfo = () => ({ scene: '1001', query: this.query });
  systemInfo = () => ({ platform: 'test', appName: 'test', screenWidth: 750, screenHeight: 1334 });
}

const files = () => {
  const out: Record<string, unknown> = {};
  for (const n of CONFIG_FILES) out[n] = JSON.parse(readFileSync(join(CONFIG_DIR, `${n}.json`), 'utf-8'));
  return out;
};

describe('App 启动、存档、前后台', () => {
  it('首次启动新建存档；切后台存档；再次启动读回并结算离线收益', () => {
    const clock = new FakeClock();
    const p = new MemPlatform(clock);
    App.boot(files(), p);
    expect(App.ready).toBe(true);
    expect(App.configErrors).toEqual([]);
    expect(p.events).toContain('session_start');
    App.core.state.gold = 999;
    p.hide.forEach((cb) => cb());
    expect(p.events).toContain('session_end');
    expect(p.store.ysh_save_v1).toBeDefined();

    clock.advance(3 * HOUR);
    App.boot(files(), p); // 模拟冷启动
    expect(App.core.state.gold).toBeGreaterThanOrEqual(999);
    expect(App.core.state.chest.ms).toBe(3 * HOUR); // 离线 3 小时攒进了宝箱
  });

  it('自动存档：每 60 秒一次', () => {
    const clock = new FakeClock();
    const p = new MemPlatform(clock);
    App.boot(files(), p);
    delete p.store.ysh_save_v1;
    for (let i = 0; i < 59; i++) {
      clock.advance(1000);
      App.update(1);
    }
    expect(p.store.ysh_save_v1).toBeUndefined();
    clock.advance(1000);
    App.update(1);
    expect(p.store.ysh_save_v1).toBeDefined();
  });

  it('三种清档方式：Boot 勾选、网址 ?reset=1、清档重开按钮（清档后切后台不会把旧进度写回）', () => {
    const clock = new FakeClock();
    const p = new MemPlatform(clock);
    App.boot(files(), p);
    App.core.state.stage = 25;
    App.save();

    App.boot(files(), p, { resetSave: true });
    expect(App.core.state.stage).toBe(0);

    App.core.state.stage = 30;
    App.save();
    p.query = { reset: '1' };
    App.boot(files(), p);
    expect(App.core.state.stage).toBe(0);
    p.query = {};

    App.core.state.stage = 40;
    App.save();
    let restarted = false;
    App.resetAndRestart(() => {
      restarted = true;
      p.hide.forEach((cb) => cb()); // 刷新页面时会触发切后台
    });
    expect(restarted).toBe(true);
    expect(p.store.ysh_save_v1).toBeUndefined();
    App.boot(files(), p);
    expect(App.core.state.stage).toBe(0);
  });
});
