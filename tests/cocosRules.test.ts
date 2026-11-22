import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Cocos Creator 的硬性规则，模拟环境检查不出来，在这里静态检查：
 * 1. 一个脚本文件里最多一个组件（@ccclass）。违反时 Cocos 3.8 报 "Each script can have at most one Component"，整个游戏黑屏。
 * 2. 组件名（@ccclass 的参数）全项目唯一。
 * 3. core/ 不能依赖引擎和抖音接口（分层规则，见 README）。
 */
const SCRIPTS = join(__dirname, '..', 'client', 'assets', 'scripts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SCRIPTS).map((p) => ({ path: relative(SCRIPTS, p), src: readFileSync(p, 'utf-8') }));
const CCCLASS = /@(?:_decorator\.)?ccclass\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('Cocos 脚本规则', () => {
  it('每个脚本文件最多一个组件', () => {
    const bad = files.filter((f) => (f.src.match(CCCLASS) || []).length > 1).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it('组件名全项目唯一', () => {
    const seen: Record<string, string> = {};
    const dup: string[] = [];
    for (const f of files) {
      for (const m of f.src.matchAll(CCCLASS)) {
        if (seen[m[1]]) dup.push(`${m[1]}（${seen[m[1]]}、${f.path}）`);
        seen[m[1]] = f.path;
      }
    }
    expect(dup).toEqual([]);
  });

  it('core/ 不引用 cc 和 tt', () => {
    const bad = files
      .filter((f) => f.path.startsWith('core'))
      .filter((f) => /from\s+['"]cc(\/[^'"]*)?['"]/.test(f.src) || /\btt\./.test(f.src))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });
});
