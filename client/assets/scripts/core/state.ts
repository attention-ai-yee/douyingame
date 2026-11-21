import { Element, ELEMENTS, Rarity, RARITIES } from './types';

/** 存档版本。字段有破坏性变化时 +1，并在 migrate() 里写升级逻辑。 */
export const SAVE_VERSION = 2;

/** 一件装备。品质沿用稀有度（凡/灵/稀/传说），阶决定数值高低。 */
export interface Item {
  id: number;
  /** 装备位：0 兽爪 1 鳞甲 2 灵铃 3 护符（见 progression.equip.slots）。 */
  slot: number;
  q: Rarity;
  tier: number;
}

export const EQUIP_SLOTS = 4;

export interface BeastState {
  star: number;
  shards: number;
  awaken: number;
  shiny: boolean;
  obtainedAt: number;
  level: number;
  equip: (Item | null)[];
}

/** 挂机宝箱：在线、离线的挂机产出都先攒在这里，玩家点宝箱领取。 */
export interface ChestState {
  /** 已经攒了多久（真实时间，毫秒），到 capHours 就不再增加。 */
  ms: number;
  gold: number;
  exp: number;
  tickets: number;
  fanShards: number;
  items: Item[];
  /** 掉落计时（折算后的挂机毫秒）。 */
  equipClock: number;
  ticketClock: number;
  shardClock: number;
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
  /** 经验（升级用，和金币一起消耗）。 */
  exp: number;
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
  chest: ChestState;
  /** 背包里的装备（穿在身上的不在这里）。 */
  bag: Item[];
  itemSeq: number;
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

export function newBeastState(now: number, extra: Partial<BeastState> = {}): BeastState {
  const b: BeastState = { star: 1, shards: 0, awaken: 0, shiny: false, obtainedAt: now, level: 1, equip: [null, null, null, null] };
  for (const k in extra) (b as unknown as Record<string, unknown>)[k] = (extra as Record<string, unknown>)[k];
  return b;
}

export function emptyChest(): ChestState {
  return { ms: 0, gold: 0, exp: 0, tickets: 0, fanShards: 0, items: [], equipClock: 0, ticketClock: 0, shardClock: 0 };
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
    exp: 0,
    team: [firstBeast, null, null, null, null],
    beasts: { [firstBeast]: newBeastState(now) },
    wildShards: emptyRecord(RARITIES, 0),
    essence: emptyRecord(ELEMENTS, 0),
    pity: { sinceXi: 0, sinceChuanshuo: 0 },
    wildStore: 0,
    wildClockMs: 0,
    daily: { dayKey: '', freeTenPullsUsed: 0, wildEncounters: 0, assistsUsed: 0 },
    signin: { round: 0, claimedInRound: 0, lastClaimDayKey: '' },
    chest: emptyChest(),
    bag: [],
    itemSeq: 0,
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
  const old = merged as unknown as { slotLevels?: number[]; pendingOffline?: { gold: number } | null };
  for (const id in merged.beasts) {
    const b = merged.beasts[id];
    if (typeof b.level !== 'number') b.level = 1;
    if (!Array.isArray(b.equip)) b.equip = [null, null, null, null];
    while (b.equip.length < EQUIP_SLOTS) b.equip.push(null);
  }
  while (merged.team.length < TEAM_SIZE) merged.team.push(null);
  if (merged.v < 2) {
    // v1 → v2：等级从阵位挪到异兽身上（谁在哪个阵位就拿哪个阵位的等级）；离线收益并进挂机宝箱
    if (old.slotLevels) {
      merged.team.forEach((id, i) => {
        if (id && merged.beasts[id]) merged.beasts[id].level = Math.max(1, old.slotLevels![i] || 1);
      });
    }
    if (old.pendingOffline && old.pendingOffline.gold > 0) merged.chest.gold += old.pendingOffline.gold;
  }
  delete old.slotLevels;
  delete old.pendingOffline;
  merged.v = SAVE_VERSION;
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
