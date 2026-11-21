import { EventData, LaunchInfo, Platform, RewardedStatus, SystemInfo } from './Platform';

/**
 * 抖音小游戏平台实现（tt.* 接口）。
 *
 * 注意（上线前对照抖音开放平台「小游戏 API」文档逐条核实）：
 * - 激励视频：tt.createRewardedVideoAd，onClose 回调里 isEnded 表示是否看完；同一个 adUnitId 复用一个实例。
 * - 插屏：tt.createInterstitialAd，这里每次展示新建实例、关闭后销毁，避免实例状态问题。
 * - 无填充错误码按 1004 处理（需核实抖音的错误码表）。
 * - tt.reportAnalytics 在小游戏里是否可用、是否需要先在后台配置事件，需核实；不可用时静默忽略。
 */

interface TTAdError {
  errCode?: number;
  errMsg?: string;
}

interface TTRewardedVideoAd {
  show(): Promise<void>;
  load(): Promise<void>;
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
  offClose(cb: (res?: { isEnded?: boolean }) => void): void;
  onError(cb: (err: TTAdError) => void): void;
  offError(cb: (err: TTAdError) => void): void;
}

interface TTInterstitialAd {
  show(): Promise<void>;
  load?(): Promise<void>;
  onClose(cb: () => void): void;
  onError(cb: (err: TTAdError) => void): void;
  destroy(): void;
}

interface TTApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  createRewardedVideoAd(opts: { adUnitId: string }): TTRewardedVideoAd;
  createInterstitialAd(opts: { adUnitId: string }): TTInterstitialAd;
  vibrateShort(opts?: object): void;
  reportAnalytics?(name: string, data: object): void;
  getLaunchOptionsSync?(): { scene?: string | number; query?: Record<string, string> };
  getSystemInfoSync(): { platform?: string; appName?: string; screenWidth?: number; screenHeight?: number };
}

declare const tt: TTApi;

const NO_FILL_CODES = [1004];

export class TTPlatform implements Platform {
  readonly name = 'douyin' as const;
  private rewarded: Record<string, TTRewardedVideoAd> = {};

  now(): number {
    return Date.now();
  }

  randomSeed(): number {
    return Math.floor(Math.random() * 4294967296);
  }

  storageGet(key: string): string | null {
    try {
      const v = tt.getStorageSync(key);
      return typeof v === 'string' && v.length > 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  storageSet(key: string, value: string): void {
    try {
      tt.setStorageSync(key, value);
    } catch (e) {
      // 存储空间满等情况：下次存档再试
    }
  }

  storageRemove(key: string): void {
    try {
      tt.removeStorageSync(key);
    } catch (e) {
      /* ignore */
    }
  }

  onShow(cb: () => void): void {
    tt.onShow(cb);
  }

  onHide(cb: () => void): void {
    tt.onHide(cb);
  }

  showRewardedVideo(adUnitId: string): Promise<RewardedStatus> {
    return new Promise<RewardedStatus>((resolve) => {
      let ad: TTRewardedVideoAd;
      try {
        ad = this.rewarded[adUnitId] || (this.rewarded[adUnitId] = tt.createRewardedVideoAd({ adUnitId }));
      } catch (e) {
        resolve('error');
        return;
      }
      let settled = false;
      const finish = (s: RewardedStatus) => {
        if (settled) return;
        settled = true;
        ad.offClose(onClose);
        ad.offError(onError);
        resolve(s);
      };
      const onClose = (res?: { isEnded?: boolean }) => finish(!res || res.isEnded ? 'completed' : 'skipped');
      const onError = (err: TTAdError) => finish(isNoFill(err) ? 'nofill' : 'error');
      ad.onClose(onClose);
      ad.onError(onError);
      ad.show().catch(() =>
        ad
          .load()
          .then(() => ad.show())
          .catch((err: TTAdError) => finish(isNoFill(err) ? 'nofill' : 'error')),
      );
    });
  }

  showInterstitial(adUnitId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let ad: TTInterstitialAd;
      try {
        ad = tt.createInterstitialAd({ adUnitId });
      } catch (e) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          ad.destroy();
        } catch (e) {
          /* ignore */
        }
        resolve(ok);
      };
      ad.onClose(() => finish(true));
      ad.onError(() => finish(false));
      const load = ad.load ? ad.load() : Promise.resolve();
      load.then(() => ad.show()).catch(() => finish(false));
    });
  }

  vibrateShort(): void {
    try {
      tt.vibrateShort({ type: 'light' });
    } catch (e) {
      /* 部分机型不支持 */
    }
  }

  reportEvent(name: string, data: EventData): void {
    try {
      if (typeof tt.reportAnalytics === 'function') tt.reportAnalytics(name, data);
    } catch (e) {
      /* ignore */
    }
  }

  launchInfo(): LaunchInfo {
    try {
      const o = tt.getLaunchOptionsSync ? tt.getLaunchOptionsSync() : {};
      return { scene: String(o.scene === undefined ? '' : o.scene), query: o.query || {} };
    } catch (e) {
      return { scene: '', query: {} };
    }
  }

  systemInfo(): SystemInfo {
    try {
      const s = tt.getSystemInfoSync();
      return {
        platform: s.platform || 'unknown',
        appName: s.appName || 'unknown',
        screenWidth: s.screenWidth || 0,
        screenHeight: s.screenHeight || 0,
      };
    } catch (e) {
      return { platform: 'unknown', appName: 'unknown', screenWidth: 0, screenHeight: 0 };
    }
  }
}

function isNoFill(err: TTAdError | undefined): boolean {
  return !!err && typeof err.errCode === 'number' && NO_FILL_CODES.indexOf(err.errCode) >= 0;
}
