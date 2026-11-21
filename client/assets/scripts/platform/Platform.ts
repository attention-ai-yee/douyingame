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
  now(): number;
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
