import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * 界面字体（resources/font/yushou.ttf）只保留了游戏里用到的字。
 * 新加的界面文字、配置表文字如果不在字体里，Cocos 里会显示成空白或方块——这里提前发现。
 * 发现缺字时运行 python3 tools/art/font.py 重新生成字体。
 */
const ROOT = join(__dirname, '..');
const FONT = join(ROOT, 'client', 'assets', 'resources', 'font', 'yushou.ttf');

/** 读 TrueType 的 cmap（format 4 和 12），返回支持的码位集合。 */
function readCmap(buf: Buffer): Set<number> {
  const numTables = buf.readUInt16BE(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('ascii', rec, rec + 4) === 'cmap') cmapOff = buf.readUInt32BE(rec + 8);
  }
  if (cmapOff < 0) throw new Error('字体里没有 cmap 表');
  const out = new Set<number>();
  const n = buf.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmapOff + buf.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = buf.readUInt16BE(ends + s * 2);
        const start = buf.readUInt16BE(starts + s * 2);
        const delta = buf.readInt16BE(deltas + s * 2);
        const ro = buf.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            const gi = buf.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2);
            g = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (g !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(sub + 12);
      for (let gIdx = 0; gIdx < groups; gIdx++) {
        const p = sub + 16 + gIdx * 12;
        const start = buf.readUInt32BE(p);
        const end = buf.readUInt32BE(p + 4);
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** 界面可能显示的文字：脚本里的字符串字面量 + 配置表里的字符串（_doc 等以 _ 开头的说明除外）。 */
function usedChars(): Map<string, string> {
  const where = new Map<string, string>();
  const add = (s: string, file: string) => {
    for (const ch of s) if (ch.codePointAt(0)! > 127 && !where.has(ch)) where.set(ch, file);
  };
  const lit = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const f of walk(join(ROOT, 'client', 'assets', 'scripts'), '.ts')) {
    const src = readFileSync(f, 'utf-8');
    for (const m of src.matchAll(lit)) add(m[1] || m[2] || m[3] || '', f);
  }
  const visit = (v: unknown, file: string): void => {
    if (typeof v === 'string') add(v, file);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, file));
    else if (v && typeof v === 'object') for (const k in v as object) if (!k.startsWith('_')) visit((v as Record<string, unknown>)[k], file);
  };
  for (const f of walk(join(ROOT, 'client', 'assets', 'resources', 'config'), '.json')) visit(JSON.parse(readFileSync(f, 'utf-8')), f);
  return where;
}

describe('界面字体', () => {
  const cmap = readCmap(readFileSync(FONT));

  it('包含全部可打印 ASCII 和常用中文标点', () => {
    for (let c = 0x20; c < 0x7f; c++) expect(cmap.has(c)).toBe(true);
    for (const ch of '，。！？：「」·×万亿') expect(cmap.has(ch.codePointAt(0)!)).toBe(true);
  });

  it('界面用到的字都在字体里（缺字时运行 python3 tools/art/font.py）', () => {
    const missing: string[] = [];
    for (const [ch, file] of usedChars()) if (!cmap.has(ch.codePointAt(0)!)) missing.push(`${ch}（${file.replace(ROOT + '/', '')}）`);
    expect(missing).toEqual([]);
  });

  it('生僻字异兽名能显示', () => {
    for (const ch of '狌褢讙鱬') expect(cmap.has(ch.codePointAt(0)!)).toBe(true);
  });
});
