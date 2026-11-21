import { angleDist, Judge, Telegraph, ZoneView } from '../../core/reveal/RevealSession';
import { RevealBehavior } from '../../core/types';

/**
 * 拍符界面的纯计算部分（不依赖 Cocos，可单测）：角度换算、弧线取点、各种"只影响表现"的视觉效果状态。
 * 角度约定和 RevealSession 一致：0 在正上方，顺时针为正；坐标为 Cocos 坐标（y 朝上），原点在圆心。
 */

export interface Pt {
  x: number;
  y: number;
}

export function polar(angleDeg: number, r: number): Pt {
  const a = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

/** 以 centerDeg 为中心、半宽 halfDeg 的圆弧上的点（用折线画弧，避免依赖引擎 arc 的方向约定）。 */
export function arcPoints(centerDeg: number, halfDeg: number, r: number, stepDeg = 2): Pt[] {
  const from = centerDeg - halfDeg;
  const n = Math.max(1, Math.ceil((halfDeg * 2) / stepDeg));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(polar(from + (halfDeg * 2 * i) / n, r));
  return pts;
}

export function inArc(angle: number, centerDeg: number, halfDeg: number): boolean {
  return angleDist(angle, centerDeg) <= halfDeg;
}

export interface VisualInput {
  /** 拍符开始后的毫秒数 */
  t: number;
  markerAngle: number;
  direction: number;
  zones: ZoneView[];
  telegraph: Telegraph | null;
  radius: number;
  /** 最近一次拍符的时间（毫秒，同 t），没有为 -Infinity */
  lastThrowT: number;
  isStruggleThrow: boolean;
}

export interface VisualState {
  /** 猾褢缩回洞里：圆环整体变暗、看不清 */
  hidden: boolean;
  /** 预告文字（探头、起身、当康、转向、挣脱），没有为 null */
  hint: string | null;
  /** 绿区透明度 0～1（帝江一闪一闪） */
  zoneAlpha: number;
  /** 水面高度：圆环被淹没的比例 0～1（从下往上，夫诸） */
  waterLevel: number;
  /** 龟壳遮挡的弧（旋龟），没有为 null */
  occluder: { center: number; half: number } | null;
  /** 符箓被龟壳或水挡住，看不见 */
  markerHidden: boolean;
  /** 绿区两侧画虎牙（驳） */
  teeth: boolean;
  /** 五采色段的中心角度（鸾鸟），没有为 null */
  rainbow: number[] | null;
  /** 圆环亮度 0～1（鹿蜀随歌谣明暗），默认 1 */
  ringPulse: number;
  /** 雷光闪烁（应龙拍完之后） */
  lightning: boolean;
}

export const JUDGE_TEXT: Record<Judge, string> = { perfect: '完美！', good: '不错', miss: '偏了…' };
export const JUDGE_COLOR: Record<Judge, string> = { perfect: '#ffd54f', good: '#ffffff', miss: '#9aa3b2' };

export function sealsText(seals: number, total: number): string {
  let s = '';
  for (let i = 0; i < total; i++) s += i < seals ? '●' : '○';
  return s;
}

export function visualState(beh: RevealBehavior, inp: VisualInput): VisualState {
  const vp = beh.visualParams || {};
  const out: VisualState = {
    hidden: false,
    hint: null,
    zoneAlpha: 1,
    waterLevel: 0,
    occluder: null,
    markerHidden: false,
    teeth: false,
    rainbow: null,
    ringPulse: 1,
    lightning: false,
  };
  const t = inp.t;

  switch (beh.visual) {
    case 'dim': {
      const interval = vp.interval || 1500;
      const duration = vp.duration || 500;
      const lead = vp.telegraph || 300;
      const phase = t % interval;
      out.hidden = phase >= interval - duration;
      if (out.hidden && phase >= interval - Math.min(lead, duration)) out.hint = '探头！';
      break;
    }
    case 'translucent': {
      const pulse = vp.pulseInterval || 700;
      out.zoneAlpha = 0.2 + 0.8 * Math.max(0, 1 - (t % pulse) / 250);
      break;
    }
    case 'water': {
      const rise = (vp.riseSec || 4) * 1000;
      const maxCover = vp.maxCover === undefined ? 0.5 : vp.maxCover;
      out.waterLevel = Math.min(maxCover, (t / rise) * maxCover);
      const waterY = -inp.radius + out.waterLevel * 2 * inp.radius;
      const markerY = inp.radius * Math.cos((inp.markerAngle * Math.PI) / 180);
      if (markerY < waterY) out.markerHidden = true;
      break;
    }
    case 'occluder': {
      const z = inp.zones[0];
      if (z) {
        const arc = vp.arcDeg || 60;
        // 龟壳挡在符箓"来的方向"上，紧挨着判定区
        const center = z.center - inp.direction * (z.halfGood + arc / 2);
        out.occluder = { center, half: arc / 2 };
        if (inArc(inp.markerAngle, center, arc / 2)) out.markerHidden = true;
      }
      break;
    }
    case 'tigerTeeth':
      out.teeth = true;
      break;
    case 'rainbow': {
      const segments = beh.zoneMove && beh.zoneMove.mode === 'cycle' ? beh.zoneMove.segments : 5;
      const z = inp.zones[0];
      if (z) {
        out.rainbow = [];
        for (let i = 0; i < segments; i++) out.rainbow.push(z.center + (i * 360) / segments);
      }
      break;
    }
    case 'tempoStripes': {
      const period = beh.speed && beh.speed.mode === 'tempo' ? beh.speed.period : 1000;
      out.ringPulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period));
      break;
    }
    case 'lightning': {
      const lead = vp.telegraph || 300;
      out.lightning = t - inp.lastThrowT >= 0 && t - inp.lastThrowT < lead;
      break;
    }
    default:
      break;
  }

  if (!out.hint && inp.telegraph) {
    if (inp.telegraph.kind === 'reverse') out.hint = '↺ 要转向了';
    else if (inp.telegraph.kind === 'fast') out.hint = '起身！';
    else if (inp.telegraph.kind === 'jump') out.hint = beh.visual === 'call' ? '当康！' : '要跳了！';
  }
  if (!out.hint && inp.isStruggleThrow) out.hint = '它要挣脱了！';
  return out;
}
