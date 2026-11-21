import { Element, ELEMENTS, Rarity, RARITIES } from './types';

/** 存档版本。字段有破坏性变化时 +1，并在 migrate() 里写升级逻辑。 */
export const SAVE_VERSION = 1;

export interface BeastState {
  star: number;
  shards: number;
  awaken: number;
  shiny: boolean;
  obtainedAt: number;
}

export interface DailyState {
  /** 本地日期 YYYY-MM-DD；跨天时重置下面的计数。 */
  dayKey: string;
  freeTenPullsUsed: number;
  wildEncounters: number;
  assistsUsed: number;
}

export interface PlayerState {
  v: number;
  createdAt: number;
  /** 最后一次在前台的时间，用来算离线收益。 */
  lastActiveAt: number;
  rngState: number;

  gold: number;
  tickets: number;
  /** 已通关的最高主线关卡（0 表示还没通关第 1 关）。 */
  stage: number;
  /** 已通关的最高镇妖塔层。 */
  floor: number;
  slotLevels: number[];
  team: (string | null)[];

  beasts: Record<string, BeastState>;
  /** 万能星魄，按稀有度。 */
  wildShards: Record<Rarity, number>;
  /** 五行精魄（觉醒材料）。 */
  essence: Record<Element, number>;
  pity: { sinceXi: number; sinceChuanshuo: number };

  /** 挂机累积的野遇（上限见 progression.wild.idleStoreCap）。 */
  wildStore: number;
  wildClockMs: number;
  daily: DailyState;
  signin: { round: number; claimedInRound: number; lastClaimDayKey: string };
  pendingOffline: { ms: number; gold: number } | null;
  tutorial: { step: number; done: boolean };
  stats: { pulls: number; reveals: number; perfects: number; adsWatched: number };
  settings: { music: boolean; sfx: boolean; vibrate: boolean };
}

export const TEAM_SIZE = 5;

export function emptyRecord<K extends string>(keys: K[], v: number): Record<K, number> {
  const r = {} as Record<K, number>;
  for (const k of keys) r[k] = v;
  return r;
}

export function createInitialState(now: number, seed: number, firstBeast = 'lei'): PlayerState {
  return {
    v: SAVE_VERSION,
    createdAt: now,
    lastActiveAt: now,
    rngState: seed >>> 0,
    gold: 0,
    tickets: 0,
    stage: 0,
    floor: 0,
    slotLevels: [1, 1, 1, 1, 1],
    team: [firstBeast, null, null, null, null],
    beasts: { [firstBeast]: { star: 1, shards: 0, awaken: 0, shiny: false, obtainedAt: now } },
    wildShards: emptyRecord(RARITIES, 0),
    essence: emptyRecord(ELEMENTS, 0),
    pity: { sinceXi: 0, sinceChuanshuo: 0 },
    wildStore: 0,
    wildClockMs: 0,
    daily: { dayKey: '', freeTenPullsUsed: 0, wildEncounters: 0, assistsUsed: 0 },
    signin: { round: 0, claimedInRound: 0, lastClaimDayKey: '' },
    pendingOffline: null,
    tutorial: { step: 0, done: false },
    stats: { pulls: 0, reveals: 0, perfects: 0, adsWatched: 0 },
    settings: { music: true, sfx: true, vibrate: true },
  };
}

/**
 * 读档：补齐缺失字段、处理旧版本。存档损坏或来自更新的版本时返回 null（由调用方决定是否新建）。
 */
export function migrate(raw: unknown, now: number, seed: number): PlayerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<PlayerState>;
  if (typeof src.v !== 'number' || src.v > SAVE_VERSION) return null;
  const base = createInitialState(typeof src.createdAt === 'number' ? src.createdAt : now, seed);
  const merged = deepFill(src as Record<string, unknown>, base as unknown as Record<string, unknown>) as unknown as PlayerState;
  // 以后 SAVE_VERSION 升级时在这里按版本逐步迁移，例如：if (merged.v < 2) { ...; merged.v = 2; }
  merged.v = SAVE_VERSION;
  while (merged.slotLevels.length < TEAM_SIZE) merged.slotLevels.push(1);
  while (merged.team.length < TEAM_SIZE) merged.team.push(null);
  return merged;
}

/** 用 defaults 补齐 src 中缺失的字段（只补不改），数组和 Record 型字段以 src 为准。 */
function deepFill(src: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in defaults) {
    const d = defaults[k];
    const s = src[k];
    if (s === undefined || s === null) {
      out[k] = d;
    } else if (d && typeof d === 'object' && !Array.isArray(d) && typeof s === 'object' && !Array.isArray(s) && k !== 'beasts') {
      out[k] = deepFill(s as Record<string, unknown>, d as Record<string, unknown>);
    } else {
      out[k] = s;
    }
  }
  // 保留 src 里 defaults 没有的字段（例如以后新版本加的、或者 beasts 的条目）
  for (const k in src) if (!(k in out)) out[k] = src[k];
  return out;
}
