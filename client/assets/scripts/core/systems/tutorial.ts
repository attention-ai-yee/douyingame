import { Ctx } from './context';

/**
 * 新手引导（游戏设计文档第 11 节，v0.6 按新界面重排）：
 * 签到领九尾狐 → 领挂机宝箱 → 一键升级 → 进山打第 1 关 → 寻兽十连。
 * 只记录"走到哪一步"，怎么指引由界面决定；玩家不按顺序操作也不会卡住（见 GameCore.tutorialStep）。
 */
export type TutorialStep = 'signin' | 'chest' | 'upgrade' | 'stage' | 'summon';
export const TUTORIAL_STEPS: TutorialStep[] = ['signin', 'chest', 'upgrade', 'stage', 'summon'];

export function currentStep(ctx: Ctx): TutorialStep | null {
  const t = ctx.s.tutorial;
  if (t.done) return null;
  return TUTORIAL_STEPS[t.step] || null;
}

/** 当前正好在 key 这一步时前进一步。返回是否前进了。 */
export function advance(ctx: Ctx, key: TutorialStep): boolean {
  if (currentStep(ctx) !== key) return false;
  const t = ctx.s.tutorial;
  t.step += 1;
  if (t.step >= TUTORIAL_STEPS.length) t.done = true;
  return true;
}

export function skip(ctx: Ctx): void {
  ctx.s.tutorial.done = true;
}

/** 老玩家（已经玩过一段）直接视为完成引导。 */
export function autoSkipForVeterans(ctx: Ctx): void {
  const s = ctx.s;
  if (!s.tutorial.done && (s.stage >= 3 || (s.stats.pulls > 0 && s.stage >= 1))) s.tutorial.done = true;
}
