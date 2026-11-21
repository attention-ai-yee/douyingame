import { describe, expect, it } from 'vitest';
import { AdService, Analytics, EventData, Platform, RewardedStatus } from '../client/assets/scripts/platform';
import { DAY, FakeClock, loadConfig, MIN } from './helpers';

class FakePlatform implements Platform {
  readonly name = 'web' as const;
  store: Record<string, string> = {};
  events: { name: string; data: EventData }[] = [];
  nextStatus: RewardedStatus = 'completed';
  interstitials = 0;
  constructor(private clock: FakeClock) {}
  now = () => this.clock.now();
  randomSeed = () => 1;
  storageGet = (k: string) => (k in this.store ? this.store[k] : null);
  storageSet = (k: string, v: string) => void (this.store[k] = v);
  storageRemove = (k: string) => void delete this.store[k];
  onShow() {}
  onHide() {}
  showRewardedVideo = async () => this.nextStatus;
  showInterstitial = async () => (this.interstitials++, true);
  vibrateShort() {}
  reportEvent = (name: string, data: EventData) => void this.events.push({ name, data });
  launchInfo = () => ({ scene: 'test', query: {} });
  systemInfo = () => ({ platform: 'test', appName: 'test', screenWidth: 750, screenHeight: 1334 });
}

function setup(release = 'mvp0') {
  const clock = new FakeClock();
  const platform = new FakePlatform(clock);
  const analytics = new Analytics(platform, () => ({ stage: 1 }));
  const installAt = clock.now();
  const ads = new AdService(platform, loadConfig().ads, analytics, { release, installAt: () => installAt });
  return { clock, platform, ads };
}

describe('AdService', () => {
  it('每日上限：看视频得进山符每天 4 次，跨天恢复', async () => {
    const { ads, clock } = setup();
    for (let i = 0; i < 4; i++) expect((await ads.showRewarded('tickets')).granted).toBe(true);
    expect(ads.available('tickets')).toBe(false);
    expect((await ads.showRewarded('tickets')).status).toBe('capped');
    clock.advance(DAY);
    expect(ads.remaining('tickets')).toBe(4);
  });

  it('按版本开放：MVP-0 没有"再拍一轮"，MVP-1 才有', () => {
    expect(setup('mvp0').ads.available('reveal_retry')).toBe(false);
    expect(setup('mvp1').ads.available('reveal_retry')).toBe(true);
  });

  it('跳过不给奖励也不占次数；无填充给 50% 并占次数', async () => {
    const { ads, platform } = setup();
    platform.nextStatus = 'skipped';
    expect(await ads.showRewarded('tickets')).toMatchObject({ granted: false, ratio: 0 });
    expect(ads.remaining('tickets')).toBe(4);
    platform.nextStatus = 'nofill';
    expect(await ads.showRewarded('tickets')).toMatchObject({ granted: true, ratio: 0.5 });
    expect(ads.remaining('tickets')).toBe(3);
  });

  it('埋点：入口曝光、点击、完成', async () => {
    const { ads, platform } = setup();
    ads.markOffered('tickets');
    await ads.showRewarded('tickets');
    expect(platform.events.map((e) => e.name)).toEqual(['ad_offer_show', 'ad_click', 'ad_complete']);
    expect(platform.events[0].data).toMatchObject({ placement: 'tickets', stage: 1 });
  });

  it('插屏：新手 10 分钟内不出，间隔 ≥ 3 分钟，每天 ≤ 6 次', async () => {
    const { ads, clock, platform } = setup();
    expect(await ads.maybeShowInterstitial('settle')).toBe(false);
    clock.advance(10 * MIN);
    expect(await ads.maybeShowInterstitial('settle')).toBe(true);
    expect(await ads.maybeShowInterstitial('settle')).toBe(false);
    for (let i = 0; i < 10; i++) {
      clock.advance(3 * MIN);
      await ads.maybeShowInterstitial('settle');
    }
    expect(platform.interstitials).toBe(6);
  });

  it('次数存进本地存储，重启后还在', async () => {
    const { ads, platform, clock } = setup();
    await ads.showRewarded('assist');
    const ads2 = new AdService(platform, loadConfig().ads, new Analytics(platform), { release: 'mvp0', installAt: () => clock.now() });
    expect(ads2.remaining('assist')).toBe(4);
  });
});
