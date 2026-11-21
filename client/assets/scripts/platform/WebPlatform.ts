import { EventData, LaunchInfo, Platform, RewardedStatus, SystemInfo } from './Platform';

/**
 * 浏览器调试用的平台实现（Cocos 编辑器预览、网页预览）。
 * 广告是模拟的：URL 加 ?ad=skipped / ?ad=nofill / ?ad=error 可以测试各种失败分支。
 */
export class WebPlatform implements Platform {
  readonly name = 'web' as const;
  private mem: Record<string, string> = {};
  private lastTouch: number | null = null;

  constructor() {
    try {
      // 事件的 timeStamp 和 performance.now() 是同一个时钟
      const rec = (e: Event) => {
        this.lastTouch = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : this.perfNow();
      };
      window.addEventListener('pointerdown', rec, { capture: true, passive: true });
      window.addEventListener('touchstart', rec, { capture: true, passive: true });
    } catch (e) {
      /* 非浏览器环境 */
    }
  }

  now(): number {
    return Date.now();
  }

  perfNow(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  lastTouchStartAt(): number | null {
    return this.lastTouch;
  }

  randomSeed(): number {
    return Math.floor(Math.random() * 4294967296);
  }

  storageGet(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return key in this.mem ? this.mem[key] : null;
    }
  }

  storageSet(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      this.mem[key] = value;
    }
  }

  storageRemove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      delete this.mem[key];
    }
  }

  onShow(cb: () => void): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') cb();
    });
  }

  onHide(cb: () => void): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cb();
    });
    window.addEventListener('pagehide', cb);
  }

  showRewardedVideo(_adUnitId: string): Promise<RewardedStatus> {
    const forced = this.query().ad as RewardedStatus | undefined;
    const status: RewardedStatus = forced === 'skipped' || forced === 'nofill' || forced === 'error' ? forced : 'completed';
    console.info(`[模拟激励视频] 结果：${status}`);
    return new Promise((resolve) => setTimeout(() => resolve(status), 500));
  }

  showInterstitial(_adUnitId: string): Promise<boolean> {
    console.info('[模拟插屏广告]');
    return Promise.resolve(true);
  }

  vibrateShort(): void {
    try {
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      /* ignore */
    }
  }

  reportEvent(name: string, data: EventData): void {
    console.debug(`[埋点] ${name}`, data);
  }

  launchInfo(): LaunchInfo {
    return { scene: 'web', query: this.query() };
  }

  systemInfo(): SystemInfo {
    return { platform: 'web', appName: 'browser', screenWidth: window.innerWidth, screenHeight: window.innerHeight };
  }

  private query(): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const q = window.location.search.replace(/^\?/, '');
      for (const kv of q.split('&')) {
        if (!kv) continue;
        const i = kv.indexOf('=');
        const k = decodeURIComponent(i >= 0 ? kv.slice(0, i) : kv);
        out[k] = decodeURIComponent(i >= 0 ? kv.slice(i + 1) : '');
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  }
}
