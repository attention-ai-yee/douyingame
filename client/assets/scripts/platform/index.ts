import { Platform } from './Platform';
import { TTPlatform } from './TTPlatform';
import { WebPlatform } from './WebPlatform';

export * from './Platform';
export * from './Analytics';
export * from './AdService';
export { TTPlatform } from './TTPlatform';
export { WebPlatform } from './WebPlatform';

declare const tt: unknown;

/** 在抖音里（存在全局 tt）用抖音实现，否则用浏览器调试实现。 */
export function createPlatform(): Platform {
  return typeof tt !== 'undefined' && tt ? new TTPlatform() : new WebPlatform();
}
