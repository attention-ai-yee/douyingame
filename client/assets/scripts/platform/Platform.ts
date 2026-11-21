/**
 * 平台接口：游戏只通过它访问抖音（或以后的微信）能力。
 * 抖音实现在 TTPlatform.ts，浏览器调试实现在 WebPlatform.ts。
 */

export type RewardedStatus = 'completed' | 'skipped' | 'nofill' | 'error';

export interface SystemInfo {
  /** ios / android / devtools / web */
  platform: string;
  appName: string;
  screenWidth: number;
  screenHeight: number;
}

export interface LaunchInfo {
  /** 启动场景值（视频锚点、搜索、侧边栏等），埋点 session_start 用。 */
  scene: string;
  query: Record<string, string>;
}

export type EventData = Record<string, string | number | boolean>;

export interface Platform {
  readonly name: 'douyin' | 'web';
  /** 墙上时间（毫秒，Date.now），用于存档、离线收益、跨天。 */
  now(): number;
  /** 高精度单调时钟（毫秒），用于拍符这类需要精确计时的玩法。 */
  perfNow(): number;
  /**
   * 最近一次原生触摸按下的时间（和 perfNow 同一时钟），没有则为 null。
   * 引擎的触摸事件要等到下一帧才分发，会晚 16～33ms；拍符用这个时间判定更准。
   */
  lastTouchStartAt(): number | null;
  randomSeed(): number;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  storageRemove(key: string): void;
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;
  showRewardedVideo(adUnitId: string): Promise<RewardedStatus>;
  showInterstitial(adUnitId: string): Promise<boolean>;
  vibrateShort(): void;
  reportEvent(name: string, data: EventData): void;
  launchInfo(): LaunchInfo;
  systemInfo(): SystemInfo;
}
