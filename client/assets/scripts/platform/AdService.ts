import { AdsConfig } from '../core/types';
import { dayKeyOf } from '../core/systems/daily';
import { Analytics } from './Analytics';
import { Platform, RewardedStatus } from './Platform';

/**
 * 广告服务：统一处理每日上限、插屏间隔、新手保护期、无填充补偿、埋点。对应 游戏设计文档 第 12 节。
 *
 * 用法（以"看视频得进山符"为例）：
 *   if (ads.available('tickets')) { 显示按钮; ads.markOffered('tickets'); }
 *   点击后：const r = await ads.showRewarded('tickets'); if (r.granted) core.grantTickets(Math.floor(5 * r.ratio));
 */

/** 版本顺序：广告位配置里 since 早于等于当前版本才开放。 */
export const RELEASES = ['mvp0', 'mvp1', 'v1.2', 'v1.3', 'v1.4', 'v1.5'];

export interface RewardedResult {
  granted: boolean;
  /** 奖励倍率：看完为 1，无填充/加载失败为 noFillRewardRatio，跳过为 0。 */
  ratio: number;
  status: RewardedStatus | 'capped' | 'busy';
}

interface AdState {
  dayKey: string;
  counts: Record<string, number>;
  interstitialCount: number;
  lastInterstitialAt: number;
}

const STORAGE_KEY = 'ysh_ads_v1';

export class AdService {
  private state: AdState;
  private showing = false;

  constructor(
    private readonly platform: Platform,
    private readonly cfg: AdsConfig,
    private readonly analytics: Analytics,
    private readonly opts: { release: string; installAt: () => number },
  ) {
    this.state = this.load();
  }

  /** 这个广告位现在能不能展示（版本已开放、没到每日上限、没有别的广告在播）。 */
  available(placement: string): boolean {
    const def = this.cfg.rewarded[placement];
    if (!def || !this.released(def.since)) return false;
    this.rollDay();
    return def.dailyCap === null || (this.state.counts[placement] || 0) < def.dailyCap;
  }

  /** 今日剩余次数；不限次数返回 null。 */
  remaining(placement: string): number | null {
    const def = this.cfg.rewarded[placement];
    if (!def) return 0;
    this.rollDay();
    return def.dailyCap === null ? null : Math.max(0, def.dailyCap - (this.state.counts[placement] || 0));
  }

  /** 广告入口展示给玩家时调用（用来算点击率）。 */
  markOffered(placement: string): void {
    this.analytics.track('ad_offer_show', { placement });
  }

  async showRewarded(placement: string): Promise<RewardedResult> {
    if (this.showing) return { granted: false, ratio: 0, status: 'busy' };
    if (!this.available(placement)) return { granted: false, ratio: 0, status: 'capped' };
    const def = this.cfg.rewarded[placement];
    const adUnitId = def.adUnitId || this.cfg.defaultRewardedAdUnitId;
    this.analytics.track('ad_click', { placement });
    this.showing = true;
    let status: RewardedStatus;
    try {
      if (!adUnitId && this.platform.name !== 'web') {
        // 开通流量主之前在抖音开发者工具里调试：按模拟广告处理。提审前必须在 ads.json 填好广告位 ID。
        console.warn(`[AdService] 广告位 ${placement} 没有配置 adUnitId，按模拟广告处理`);
        status = 'completed';
      } else {
        status = await this.platform.showRewardedVideo(adUnitId);
      }
    } catch (e) {
      status = 'error';
    } finally {
      this.showing = false;
    }
    if (status === 'skipped') {
      this.analytics.track('ad_fail', { placement, reason: status, granted: false });
      return { granted: false, ratio: 0, status };
    }
    this.state.counts[placement] = (this.state.counts[placement] || 0) + 1;
    this.save();
    if (status === 'completed') {
      this.analytics.track('ad_complete', { placement, granted: true });
      return { granted: true, ratio: 1, status };
    }
    // 无填充或加载失败：不是玩家的错，发一部分奖励
    const ratio = this.cfg.noFillRewardRatio;
    this.analytics.track('ad_fail', { placement, reason: status, granted: ratio > 0, ratio });
    return { granted: ratio > 0, ratio, status };
  }

  /** 插屏：只在结算页调用；新手保护期内、间隔不足、超过每日上限时不展示。 */
  async maybeShowInterstitial(where: string): Promise<boolean> {
    const rule = this.cfg.interstitial;
    const now = this.platform.now();
    this.rollDay();
    if (this.showing) return false;
    if (now - this.opts.installAt() < rule.newUserGraceSec * 1000) return false;
    if (now - this.state.lastInterstitialAt < rule.minIntervalSec * 1000) return false;
    if (this.state.interstitialCount >= rule.dailyCap) return false;
    if (!this.cfg.interstitialAdUnitId && this.platform.name !== 'web') return false;
    this.showing = true;
    let ok = false;
    try {
      ok = await this.platform.showInterstitial(this.cfg.interstitialAdUnitId);
    } finally {
      this.showing = false;
    }
    if (ok) {
      this.state.interstitialCount += 1;
      this.state.lastInterstitialAt = now;
      this.save();
      this.analytics.track('ad_complete', { placement: `interstitial_${where}`, granted: false });
    }
    return ok;
  }

  private released(since: string): boolean {
    const a = RELEASES.indexOf(since);
    const b = RELEASES.indexOf(this.opts.release);
    return a >= 0 && b >= 0 && a <= b;
  }

  private rollDay(): void {
    const key = dayKeyOf(this.platform.now());
    if (this.state.dayKey !== key) {
      this.state = { dayKey: key, counts: {}, interstitialCount: 0, lastInterstitialAt: this.state.lastInterstitialAt };
      this.save();
    }
  }

  private load(): AdState {
    const empty: AdState = { dayKey: '', counts: {}, interstitialCount: 0, lastInterstitialAt: 0 };
    const raw = this.platform.storageGet(STORAGE_KEY);
    if (!raw) return empty;
    try {
      const s = JSON.parse(raw) as AdState;
      return { dayKey: s.dayKey || '', counts: s.counts || {}, interstitialCount: s.interstitialCount || 0, lastInterstitialAt: s.lastInterstitialAt || 0 };
    } catch (e) {
      return empty;
    }
  }

  private save(): void {
    this.platform.storageSet(STORAGE_KEY, JSON.stringify(this.state));
  }
}
