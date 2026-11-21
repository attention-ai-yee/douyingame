import { assembleConfig, GameConfig, GameCore, validateConfig } from '../core';
import { AdService, Analytics, createPlatform, Platform } from '../platform';

/** 当前发布阶段，决定哪些广告位和功能开放（见 ads.json 的 since）。 */
export const RELEASE = 'mvp0';
const SAVE_KEY = 'ysh_save_v1';
const AUTOSAVE_SEC = 60;

/**
 * 应用容器：把配置、平台、GameCore、广告、埋点组装起来，负责存档和前后台切换。
 * 不依赖 Cocos，Boot.ts 加载完配置表后调用 App.boot()。其他界面脚本通过 App.core / App.ads 访问。
 */
export class App {
  static platform: Platform;
  static cfg: GameConfig;
  static core: GameCore;
  static analytics: Analytics;
  static ads: AdService;
  static ready = false;
  /** 配置校验错误（开发期在调试面板显示）。 */
  static configErrors: string[] = [];
  private static sinceSave = 0;
  private static sessionStartAt = 0;

  static boot(configFiles: Record<string, unknown>, platform: Platform = createPlatform()): void {
    App.platform = platform;
    App.cfg = assembleConfig(configFiles);
    App.configErrors = validateConfig(App.cfg);
    if (App.configErrors.length) console.error('[配置校验失败]\n' + App.configErrors.join('\n'));

    const now = platform.now();
    const state = GameCore.loadState(platform.storageGet(SAVE_KEY), now, platform.randomSeed());
    App.core = new GameCore(App.cfg, { clock: () => platform.now(), state });
    App.analytics = new Analytics(platform, () => ({
      stage: App.core.state.stage,
      floor: App.core.state.floor,
      days: Math.floor((platform.now() - App.core.state.createdAt) / 86400000),
    }));
    App.ads = new AdService(platform, App.cfg.ads, App.analytics, { release: RELEASE, installAt: () => App.core.state.createdAt });

    App.core.resume();
    App.startSession();
    platform.onShow(() => {
      App.core.resume();
      App.startSession();
    });
    platform.onHide(() => {
      App.core.pause();
      App.save();
      App.analytics.track('session_end', { seconds: Math.round((platform.now() - App.sessionStartAt) / 1000) });
    });
    App.ready = true;
  }

  /** 每帧调用（Boot.update）。 */
  static update(dtSec: number): void {
    if (!App.ready) return;
    App.core.tick();
    App.sinceSave += dtSec;
    if (App.sinceSave >= AUTOSAVE_SEC) App.save();
  }

  /** 关键操作（抽兽、升星、领奖）后也调用一次。 */
  static save(): void {
    if (!App.ready) return;
    App.sinceSave = 0;
    App.platform.storageSet(SAVE_KEY, App.core.serialize());
  }

  /** 开发用：清档重开。 */
  static resetSave(): void {
    App.platform.storageRemove(SAVE_KEY);
  }

  private static startSession(): void {
    App.sessionStartAt = App.platform.now();
    App.analytics.track('session_start', { scene: App.platform.launchInfo().scene });
  }
}
