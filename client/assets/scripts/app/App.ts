import { assembleConfig, GameConfig, GameCore, validateConfig } from '../core';
import { ADS_STORAGE_KEY, AdService, Analytics, createPlatform, Platform } from '../platform';

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
  private static boundPlatform: Platform | null = null;
  /** 清档重开期间为 true，防止切后台/销毁时把旧进度又存回去。 */
  private static saveBlocked = false;

  /**
   * 启动。opts.resetSave 为 true 时先清掉存档（Boot 组件勾选 Reset Save On Start）；
   * 浏览器预览时网址带 ?reset=1 也会清档。
   */
  static boot(configFiles: Record<string, unknown>, platform: Platform = createPlatform(), opts: { resetSave?: boolean } = {}): void {
    App.ready = false;
    App.saveBlocked = false;
    App.platform = platform;
    const urlReset = platform.name === 'web' && platform.launchInfo().query.reset === '1';
    if (opts.resetSave || urlReset) {
      App.clearSave();
      console.log('[App] 已清除存档，从头开始');
    }
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
    App.ads = new AdService(platform, App.cfg.ads, App.analytics, {
      release: RELEASE,
      installAt: () => App.core.state.createdAt,
      onWatched: () => App.core.recordAdWatched(),
    });

    App.core.resume();
    App.startSession();
    if (App.boundPlatform !== platform) {
      // 每个平台对象只注册一次；回调里用的是 App 的静态字段，清档重开后自动指向新的 core
      App.boundPlatform = platform;
      platform.onShow(() => {
        if (!App.ready) return;
        App.core.resume();
        App.startSession();
      });
      platform.onHide(() => {
        if (!App.ready) return;
        App.core.pause();
        App.save();
        App.analytics.track('session_end', { seconds: Math.round((App.platform.now() - App.sessionStartAt) / 1000) });
      });
    }
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
    if (!App.ready || App.saveBlocked) return;
    App.sinceSave = 0;
    App.platform.storageSet(SAVE_KEY, App.core.serialize());
  }

  /** 删除存档和广告计数。 */
  static clearSave(): void {
    App.platform.storageRemove(SAVE_KEY);
    App.platform.storageRemove(ADS_STORAGE_KEY);
  }

  /** 开发用：清档并重启游戏。restart 由 view 层提供（浏览器里刷新页面，抖音里 game.restart()）。 */
  static resetAndRestart(restart: () => void): void {
    App.saveBlocked = true;
    App.clearSave();
    App.ready = false;
    restart();
  }

  private static startSession(): void {
    App.sessionStartAt = App.platform.now();
    App.analytics.track('session_start', { scene: App.platform.launchInfo().scene });
  }
}
