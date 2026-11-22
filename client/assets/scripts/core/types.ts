/**
 * 配置表与通用类型。
 *
 * core/ 目录下的代码不依赖 Cocos（不 import 'cc'），也不依赖抖音 tt 接口，
 * 这样可以在 Node 里跑单元测试，也方便以后换引擎或上微信小游戏。
 * 写法上避开 const enum、装饰器、satisfies 等 Cocos 内置编译器可能不支持的语法。
 */

export type Rarity = 'fan' | 'ling' | 'xi' | 'chuanshuo';
export const RARITIES: Rarity[] = ['fan', 'ling', 'xi', 'chuanshuo'];
export type Element = 'mu' | 'huo' | 'tu' | 'jin' | 'shui';
export const ELEMENTS: Element[] = ['mu', 'huo', 'tu', 'jin', 'shui'];
export type Role = 'gong' | 'shou' | 'fu';
export type DepthId = 'shallow' | 'deep' | 'secret';

/** 下一档稀有度（熔炼用），传说没有下一档。 */
export function nextRarity(r: Rarity): Rarity | null {
  const i = RARITIES.indexOf(r);
  return i >= 0 && i < RARITIES.length - 1 ? RARITIES[i + 1] : null;
}

export function rarityAtLeast(r: Rarity, min: Rarity): boolean {
  return RARITIES.indexOf(r) >= RARITIES.indexOf(min);
}

// ---------------------------------------------------------------- beasts.json

export interface RarityDef {
  name: string;
  power: number;
  atk: number;
  hp: number;
  spd: [number, number];
  color: string;
}

export interface ElementDef {
  name: string;
  color: string;
  beats: Element;
}

export interface RoleDef {
  name: string;
  atk: number;
  hp: number;
}

/** 现身行为参数，字段含义见 core/reveal/RevealSession.ts 顶部注释。 */
export interface RevealBehavior {
  speed?:
    | { mode: 'constant' }
    | { mode: 'tempo'; period: number; amp: number }
    | { mode: 'twoSpeed'; slow: number; fast: number; holdMin: number; holdMax: number; telegraph?: number }
    | { mode: 'rampPerLap'; perLap: number }
    | { mode: 'decelNearZone'; rangeDeg: number; factor: number };
  motion?: { mode: 'smooth' } | { mode: 'step'; stepDeg: number };
  zones?: {
    count?: number;
    layout?: 'single' | 'mirror' | 'even';
    sizeFactor?: number;
    activeCount?: number;
    activeInterval?: number;
  };
  zoneMove?:
    | { mode: 'none' }
    | { mode: 'timedJump'; interval: number; telegraph?: number }
    | { mode: 'cycle'; segments: number; interval: number }
    | { mode: 'onThrowOpposite' }
    | { mode: 'onThrowNextCell'; cells: number }
    | { mode: 'drift'; degPerSec: number };
  onThrow?: { speedMul?: number; reverse?: boolean };
  reverseTimed?: { interval: number; telegraph?: number };
  noGoodZone?: boolean;
  /** 只影响表现、不影响判定的效果，由 view 层实现。 */
  visual?: string;
  visualParams?: Record<string, number>;
}

export interface BeastDef {
  id: string;
  /** 头像上的代表字（占位头像、美术生成器用）。 */
  glyph?: string;
  /** 立绘朝向，默认朝右；朝左的在战斗里自动翻转。 */
  facing?: 'left' | 'right';
  name: string;
  element: Element;
  rarity: Rarity;
  role: Role;
  habitat: string;
  quote: string;
  skill: string;
  reveal: RevealBehavior;
}

export interface BeastsConfig {
  rarities: Record<Rarity, RarityDef>;
  elements: Record<Element, ElementDef>;
  elementCounter: { advantage: number; disadvantage: number };
  roles: Record<Role, RoleDef>;
  beasts: BeastDef[];
}

// ---------------------------------------------------------------- pools.json

export type WeightedBeast = [string, number];

export interface MountainDef {
  id: string;
  name: string;
  chapter: number;
  tiers: Record<Rarity, WeightedBeast[]>;
}

export interface PoolsConfig {
  mountains: MountainDef[];
  depths: Record<DepthId, { name: string; rates: Record<Rarity, number> }>;
  deepUnlockWithinChapter: number;
  pity: { xi: number; chuanshuo: number };
  tenPullMinRarity: Rarity;
  shinyRate: number;
  dailyFreeTenPulls: number;
}

// ---------------------------------------------------------------- progression.json

export interface ProgressionConfig {
  star: { costs: number[]; mults: number[]; shinyDupShards: number; shinyStatBonus: number };
  awaken: { enabled: boolean; shardCosts: number[]; essenceCosts: number[]; mults: number[]; skillBoostAtLevel: number };
  melt: { ratio: number };
  /** 异兽等级：升级花金币和经验，属性按 statGrowth 增长。 */
  level: { costBase: number; costGrowth: number; statGrowth: number; expRatio: number };
  slots: { unlocks: { stage: number; slots: number }[] };
  synergyPower: { two: number; four: number };
  gold: {
    perMinBase: number;
    perMinGrowth: number;
    firstClearMinutes: number;
    treasureEvery: number;
    treasureMult: number;
  };
  chest: {
    capHours: number;
    offlineRatio: number;
    /** 离开超过这么多分钟，回来时自动弹出宝箱。 */
    popupMinMinutes: number;
    equipEveryMinutes: number;
    ticketEveryHours: number;
    fanShardEveryHours: number;
    maxItems: number;
    /** 新手引导的第一个宝箱额外放多少分钟产出、几件装备。 */
    tutorialMinutes: number;
    tutorialItems: number;
  };
  equip: EquipConfig;
  assist: { powerMult: number; dailyCap: number };
  wild: { stageClearChance: number; idleEveryHours: number; idleStoreCap: number; dailyCap: number };
  daily: { taskTickets: number };
}

export type EquipStat = 'atk' | 'hp';

export interface EquipConfig {
  slots: { name: string; stat: EquipStat }[];
  quality: Record<Rarity, { pct: number; dismantleMinutes: number }>;
  tierStages: number;
  tierStep: number;
  bagCap: number;
  dropWeights: { fromStage: number; weights: Record<Rarity, number> }[];
  firstClear: { smallBoss: Rarity; chapterBoss: Rarity };
}

// ---------------------------------------------------------------- stages.json

export interface ChapterDef {
  id: number;
  mountain: string;
  name: string;
  boss: { name: string; element: Element; captureBeast: string | null; rewardTickets: number };
}

export interface StagesConfig {
  chapterLength: number;
  chapters: ChapterDef[];
  enemy: {
    base: number;
    segments: { from: number; to: number; growth: number }[];
    smallBossEvery: number;
    smallBossMult: number;
    chapterBossMult: number;
    /** 第 1～N 关的固定敌方战力（新手关）。 */
    tutorialEnemyPower: number[];
  };
  rewards: { smallBossTickets: number };
  tower: {
    unlockStage: number;
    baseStage: number;
    growth: number;
    bossEvery: number;
    bossMult: number;
    postMainStagePerFloor: number;
    quickChallengeRatio: number;
    rewards: { ticketsEvery: number; tickets: number; lingWildEvery: number; xiWildEvery: number };
  };
}

// ---------------------------------------------------------------- reveal.json

export type RevealSource = 'pull' | 'wild' | 'boss' | 'signin';

export interface RevealConfig {
  throws: number;
  rarity: Record<Rarity, { perfectMs: number; speed: number }>;
  goodWidthFactor: number;
  bossPerfectMinusMs: number;
  minPerfectMs: number;
  legendLastThrowSpeedMult: number;
  skipSeals: number;
  rewards: {
    twoSeals: { goldMinutes: number };
    threeSeals: { shards: number; dianjingChance: number };
  };
  trigger: Record<RevealSource, Rarity[]>;
}

// ---------------------------------------------------------------- ads.json

export interface RewardedPlacementDef {
  name: string;
  dailyCap: number | null;
  since: string;
  adUnitId?: string;
  tickets?: number;
  minutes?: number;
}

export interface AdsConfig {
  defaultRewardedAdUnitId: string;
  interstitialAdUnitId: string;
  noFillRewardRatio: number;
  rewarded: Record<string, RewardedPlacementDef>;
  interstitial: { minIntervalSec: number; newUserGraceSec: number; dailyCap: number };
}

// ---------------------------------------------------------------- signin.json

export interface SigninReward {
  day: number;
  beast?: string;
  tickets?: number;
  choice?: string[];
  wild?: Partial<Record<Rarity, number>>;
  goldMinutes?: number;
}

export interface SigninConfig {
  firstRound: SigninReward[];
  laterRounds: SigninReward[];
}

// ---------------------------------------------------------------- 汇总

export interface GameConfig {
  beasts: BeastsConfig;
  pools: PoolsConfig;
  progression: ProgressionConfig;
  stages: StagesConfig;
  reveal: RevealConfig;
  ads: AdsConfig;
  signin: SigninConfig;
}

export const CONFIG_FILES: (keyof GameConfig)[] = ['beasts', 'pools', 'progression', 'stages', 'reveal', 'ads', 'signin'];
