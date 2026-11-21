import { readFileSync } from 'fs';
import { join } from 'path';
import { assembleConfig, CONFIG_FILES, GameConfig, GameCore, PlayerState } from '../client/assets/scripts/core';

export const CONFIG_DIR = join(__dirname, '..', 'client', 'assets', 'resources', 'config');

export function loadConfig(): GameConfig {
  const files: Record<string, unknown> = {};
  for (const name of CONFIG_FILES) files[name] = JSON.parse(readFileSync(join(CONFIG_DIR, `${name}.json`), 'utf-8'));
  return assembleConfig(files);
}

/** 深拷贝一份配置，方便测试里改坏它。 */
export function cloneConfig(cfg: GameConfig = loadConfig()): GameConfig {
  return JSON.parse(JSON.stringify(cfg));
}

export class FakeClock {
  constructor(public t: number = Date.UTC(2026, 11, 1, 2, 0, 0)) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function makeCore(opts: { seed?: number; state?: PlayerState; cfg?: GameConfig } = {}): { core: GameCore; clock: FakeClock } {
  const clock = new FakeClock();
  const core = new GameCore(opts.cfg || loadConfig(), { clock: clock.now, seed: opts.seed ?? 42, state: opts.state });
  return { core, clock };
}
