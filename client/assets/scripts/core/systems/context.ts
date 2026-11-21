import { ConfigIndex } from '../config';
import { Formulas } from '../formulas';
import { Rng } from '../rng';
import { PlayerState } from '../state';

/** 各个 system 共用的上下文。system 都是纯函数：读 ctx、改 ctx.s、返回结果，不发事件。 */
export interface Ctx {
  idx: ConfigIndex;
  f: Formulas;
  s: PlayerState;
  rng: Rng;
  now: number;
}
