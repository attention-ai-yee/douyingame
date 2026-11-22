import { EventData, Platform } from './Platform';

/**
 * 埋点。事件名和字段见 游戏设计文档 第 15 节。
 * 每个事件自动带上公共字段（注册天数、当前关卡等），先发到平台；以后有自己的后端再加一路上报。
 */
export type EventName =
  | 'session_start'
  | 'session_end'
  | 'tutorial_step'
  | 'stage_open'
  | 'stage_start'
  | 'stage_win'
  | 'stage_fail'
  | 'tower_win'
  | 'tower_fail'
  | 'pull'
  | 'reveal_start'
  | 'reveal_result'
  | 'reveal_throw'
  | 'star_up'
  | 'melt'
  | 'awaken'
  | 'beast_level_up'
  | 'team_level_up'
  | 'ad_offer_show'
  | 'ad_click'
  | 'ad_complete'
  | 'ad_fail'
  | 'chest_claim'
  | 'task_claim';

export class Analytics {
  /** 最近的事件，调试面板可以显示。 */
  readonly recent: { name: EventName; data: EventData; t: number }[] = [];
  private readonly maxRecent = 200;

  constructor(
    private readonly platform: Platform,
    private readonly common: () => EventData = () => ({}),
  ) {}

  track(name: EventName, data: EventData = {}): void {
    const payload: EventData = {};
    const c = this.common();
    for (const k in c) payload[k] = c[k];
    for (const k in data) payload[k] = data[k];
    this.recent.push({ name, data: payload, t: this.platform.now() });
    if (this.recent.length > this.maxRecent) this.recent.shift();
    this.platform.reportEvent(name, payload);
  }
}
