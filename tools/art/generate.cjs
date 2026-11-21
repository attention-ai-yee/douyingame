#!/usr/bin/env node
/**
 * 《御兽山海》默认美术素材生成器（国风水墨 v0）。
 *
 * 注意：水墨风格已被否决，改为 Q 版（样稿已给用户确认中）。这里的渲染流程（SVG → 无头 Chromium → PNG、
 * 开源字体加载、九宫格边距清单）会保留，绘图部分会整体换成 Q 版。生成的图片暂不提交。
 *
 * 用代码画 SVG，再用无头 Chromium 渲染成 PNG/JPG，输出到 client/assets/resources/skin/。
 * 这是"没有美术时也能看"的默认皮肤：界面边框、按钮、背景、图标、异兽水墨头像。
 * 以后有了正式美术，用同名文件覆盖即可，游戏代码不用改。
 *
 * 用法：  node tools/art/generate.cjs            # 生成全部
 *        node tools/art/generate.cjs beast_lei  # 只生成名字包含 beast_lei 的
 * 依赖：  playwright（环境自带 Chromium）、@fontsource 开源字体（OFL 授权，可商用）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'client', 'assets', 'resources', 'skin');
const FONT_CSS = [
  '@fontsource/ma-shan-zheng/index.css',
  '@fontsource/zcool-xiaowei/index.css',
  '@fontsource/noto-serif-sc/900.css',
].map((p) => 'file://' + path.join(ROOT, 'node_modules', p));
const BEASTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/resources/config/beasts.json'), 'utf-8'));

// ---------------------------------------------------------------- 调色板
const C = {
  paper: '#efe6d2',
  paperLight: '#f6efde',
  ink: '#1f1b16',
  inkSoft: '#5b544a',
  cinnabar: '#b3261e',
  cinnabarDark: '#7f1a14',
  gold: '#c9a227',
  goldLight: '#ecd27a',
  jade: '#2f8f68',
};
const BRUSH = "'Ma Shan Zheng','Noto Serif SC',serif";

// ---------------------------------------------------------------- 工具
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 通用滤镜：宣纸纹理、毛笔边缘、晕染。 */
function defs(seed = 1) {
  return `
  <filter id="paperNoise" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.32  0 0 0 0 0.27  0 0 0 0 0.2  0 0 0 0.09 0"/>
  </filter>
  <filter id="fiber" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.18" numOctaves="2" seed="${seed + 3}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.4  0 0 0 0 0.34  0 0 0 0 0.25  0 0 0 0.06 0"/>
  </filter>
  <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="${seed + 7}" result="t"/>
    <feDisplacementMap in="SourceGraphic" in2="t" scale="7" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="roughSoft" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="${seed + 11}" result="t"/>
    <feDisplacementMap in="SourceGraphic" in2="t" scale="3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="wash" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="${seed + 13}" result="t"/>
    <feDisplacementMap in="SourceGraphic" in2="t" scale="26" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="2.2"/>
  </filter>
  <filter id="mist" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="blur4"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

function svg(w, h, body, seed = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs(seed)}</defs>${body}</svg>`;
}

/** 起伏的山脊：返回闭合路径（底边在 baseY 以下）。 */
function ridge(r, w, h, topY, amp, peaks) {
  const pts = [];
  const n = 60;
  const ph = [r() * 6, r() * 6, r() * 6];
  const centers = [];
  for (let i = 0; i < peaks; i++) centers.push({ x: (i + 0.3 + r() * 0.4) / peaks, a: 0.5 + r() * 0.6, wd: 0.06 + r() * 0.08 });
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    let y = Math.sin(x * 5 + ph[0]) * 0.18 + Math.sin(x * 13 + ph[1]) * 0.07 + Math.sin(x * 29 + ph[2]) * 0.025;
    for (const c of centers) y += c.a * Math.exp(-((x - c.x) ** 2) / (2 * c.wd ** 2));
    pts.push([x * w, topY + amp * (1 - y)]);
  }
  let d = `M0,${h} L${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  return d + ` L${w},${h} Z`;
}

// ---------------------------------------------------------------- 背景
const BATTLE_TINT = {
  nanshan: { ink: '#2f4a3a', far: '#7f9a86', sky: '#ebe4cf', sun: '#c0392b', name: '南山经' },
  xishan: { ink: '#5a4626', far: '#a6926a', sky: '#efe3c3', sun: '#c0392b', name: '西山经' },
  beidongzhong: { ink: '#2c3e50', far: '#8496a6', sky: '#e4e7e5', sun: '#a33a32', name: '北山经' },
};

function battleBg(key, seed) {
  const w = 750;
  const h = 620;
  const t = BATTLE_TINT[key];
  const r = rng(seed);
  const layers = [
    { top: 150, amp: 150, peaks: 3, color: t.far, op: 0.35, blur: 3 },
    { top: 230, amp: 170, peaks: 4, color: t.far, op: 0.55, blur: 1.5 },
    { top: 330, amp: 150, peaks: 3, color: t.ink, op: 0.6, blur: 0.6 },
    { top: 440, amp: 110, peaks: 5, color: t.ink, op: 0.85, blur: 0 },
  ];
  let body = `<rect width="${w}" height="${h}" fill="${t.sky}"/>
    <rect width="${w}" height="${h}" filter="url(#paperNoise)"/>
    <circle cx="${560 + r() * 80}" cy="${110 + r() * 30}" r="38" fill="${t.sun}" opacity="0.75" filter="url(#roughSoft)"/>`;
  layers.forEach((L, i) => {
    body += `<linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.color}" stop-opacity="${L.op}"/><stop offset="1" stop-color="${L.color}" stop-opacity="0"/></linearGradient>`;
    body += `<path d="${ridge(r, w, h, L.top, L.amp, L.peaks)}" fill="url(#g${i})" filter="url(#rough)" ${L.blur ? `style="filter:url(#rough) blur(${L.blur}px)"` : ''}/>`;
    // 山间云雾
    body += `<ellipse cx="${r() * w}" cy="${L.top + L.amp * 0.9}" rx="${200 + r() * 160}" ry="${16 + r() * 14}" fill="#ffffff" opacity="${0.55 - i * 0.08}" filter="url(#mist)"/>`;
  });
  // 地面
  body += `<rect y="${h - 110}" width="${w}" height="110" fill="${t.ink}" opacity="0.12"/>
    <path d="M0,${h - 112} Q${w * 0.3},${h - 124} ${w * 0.55},${h - 110} T${w},${h - 114}" stroke="${t.ink}" stroke-width="3" fill="none" opacity="0.45" filter="url(#rough)"/>
    <rect width="${w}" height="${h}" filter="url(#fiber)"/>`;
  return svg(w, h, body, seed);
}

function mainBg() {
  const w = 750;
  const h = 1334;
  const r = rng(77);
  let body = `<rect width="${w}" height="${h}" fill="${C.paper}"/>
    <rect width="${w}" height="${h}" filter="url(#paperNoise)"/>
    <rect width="${w}" height="${h}" filter="url(#fiber)"/>
    <linearGradient id="bottomInk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.ink}" stop-opacity="0"/><stop offset="1" stop-color="${C.ink}" stop-opacity="0.18"/></linearGradient>
    <path d="${ridge(r, w, h, h - 260, 120, 4)}" fill="url(#bottomInk)" filter="url(#rough)"/>`;
  return svg(w, h, body, 77);
}

// ---------------------------------------------------------------- 面板与按钮（九宫格）
function panelPaper() {
  const s = 160;
  return svg(s, s, `
    <rect x="6" y="6" width="${s - 12}" height="${s - 12}" rx="18" fill="${C.paperLight}"/>
    <rect x="6" y="6" width="${s - 12}" height="${s - 12}" rx="18" filter="url(#paperNoise)"/>
    <rect x="15" y="15" width="${s - 30}" height="${s - 30}" rx="12" fill="none" stroke="${C.gold}" stroke-width="1.5" opacity="0.7"/>
    <rect x="6" y="6" width="${s - 12}" height="${s - 12}" rx="18" fill="none" stroke="${C.ink}" stroke-width="3.5" filter="url(#roughSoft)"/>`);
}

function panelInk() {
  const s = 160;
  return svg(s, s, `
    <rect x="4" y="4" width="${s - 8}" height="${s - 8}" rx="18" fill="#17191e" fill-opacity="0.92"/>
    <rect x="4" y="4" width="${s - 8}" height="${s - 8}" rx="18" fill="none" stroke="${C.gold}" stroke-width="2.5"/>
    <rect x="12" y="12" width="${s - 24}" height="${s - 24}" rx="12" fill="none" stroke="${C.gold}" stroke-width="1" opacity="0.35"/>`);
}

function button(top, bottom, border, highlight = 0.28) {
  const w = 240;
  const h = 96;
  return svg(w, h, `
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <rect x="5" y="7" width="${w - 10}" height="${h - 12}" rx="24" fill="#000" opacity="0.25" filter="url(#blur4)"/>
    <rect x="4" y="4" width="${w - 8}" height="${h - 12}" rx="24" fill="url(#bg)" filter="url(#roughSoft)"/>
    <rect x="16" y="10" width="${w - 32}" height="${(h - 12) * 0.38}" rx="16" fill="#fff" opacity="${highlight}"/>
    <rect x="4" y="4" width="${w - 8}" height="${h - 12}" rx="24" fill="none" stroke="${border}" stroke-width="3"/>`);
}

function pill() {
  const w = 220;
  const h = 64;
  return svg(w, h, `
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="30" fill="#16181d" fill-opacity="0.78"/>
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="30" fill="none" stroke="${C.gold}" stroke-width="2" opacity="0.85"/>`);
}

function tabBar() {
  const w = 750;
  const h = 160;
  let clouds = '';
  for (let i = 0; i < 6; i++) {
    const x = 60 + i * 130;
    clouds += `<path d="M${x},110 q18,-26 36,0 q18,-26 36,0" stroke="${C.gold}" stroke-width="2" fill="none" opacity="0.12"/>`;
  }
  return svg(w, h, `
    <linearGradient id="tb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a251e"/><stop offset="1" stop-color="#14120e"/></linearGradient>
    <rect width="${w}" height="${h}" fill="url(#tb)"/>
    <rect width="${w}" height="${h}" filter="url(#fiber)"/>
    ${clouds}
    <rect y="0" width="${w}" height="4" fill="${C.gold}"/>
    <rect y="7" width="${w}" height="1.5" fill="${C.gold}" opacity="0.5"/>`);
}

function hpBar(kind) {
  const w = 120;
  const h = 18;
  if (kind === 'bg') return svg(w, h, `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="#111" fill-opacity="0.85" stroke="#000" stroke-width="1.5"/>`);
  const [a, b] = kind === 'green' ? ['#7ee8a8', '#2e9e62'] : ['#ff9a8a', '#b3261e'];
  return svg(w, h, `<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="6" fill="url(#h)"/>`);
}

// ---------------------------------------------------------------- 头像边框（按稀有度）
const RARITY_FRAME = { fan: ['#d9d4c8', '#8f887a'], ling: ['#7fb3ec', '#2f6fb5'], xi: ['#c49be0', '#7a3fa3'], chuanshuo: ['#ffe08a', '#c48a12'] };
function frame(rarity) {
  const s = 180;
  const [a, b] = RARITY_FRAME[rarity];
  const c = s / 2;
  let orn = '';
  for (const ang of [0, 90, 180, 270]) {
    const rad = (ang * Math.PI) / 180;
    const x = c + Math.sin(rad) * 80;
    const y = c - Math.cos(rad) * 80;
    orn += `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${a}" stroke="${b}" stroke-width="2" transform="rotate(45 ${x} ${y})"/>`;
  }
  const glow = rarity === 'chuanshuo' ? `<circle cx="${c}" cy="${c}" r="80" fill="none" stroke="${a}" stroke-width="10" opacity="0.6" filter="url(#glow)"/>` : '';
  return svg(s, s, `
    <linearGradient id="fr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    ${glow}
    <circle cx="${c}" cy="${c}" r="80" fill="none" stroke="#1a1712" stroke-width="13"/>
    <circle cx="${c}" cy="${c}" r="80" fill="none" stroke="url(#fr)" stroke-width="8"/>
    ${orn}`);
}

// ---------------------------------------------------------------- 图标
function iconCoin() {
  return svg(112, 112, `
    <radialGradient id="cg" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.45" stop-color="#e7bf47"/><stop offset="1" stop-color="#9a6d0e"/></radialGradient>
    <circle cx="56" cy="58" r="44" fill="#000" opacity="0.25" filter="url(#blur4)"/>
    <circle cx="56" cy="54" r="44" fill="url(#cg)" stroke="#6e4c08" stroke-width="3"/>
    <circle cx="56" cy="54" r="35" fill="none" stroke="#8a6210" stroke-width="2" opacity="0.7"/>
    <rect x="44" y="42" width="24" height="24" fill="#5a3e07" stroke="#3d2a04" stroke-width="2"/>`);
}

function iconTicket() {
  return svg(112, 112, `
    <g transform="rotate(-12 56 56)">
      <rect x="32" y="12" width="48" height="88" rx="4" fill="#000" opacity="0.2" filter="url(#blur4)"/>
      <rect x="30" y="8" width="48" height="88" rx="4" fill="#f2d16b" stroke="#a37d16" stroke-width="2"/>
      <path d="M54,20 C40,30 68,38 52,48 C38,58 70,64 54,74 C44,80 60,86 54,90" stroke="${C.cinnabar}" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#roughSoft)"/>
      <circle cx="54" cy="24" r="5" fill="${C.cinnabar}"/>
    </g>`);
}

function iconPower() {
  return svg(112, 112, `
    <radialGradient id="fg" cx="0.5" cy="0.8" r="0.8"><stop offset="0" stop-color="#ffe082"/><stop offset="0.5" stop-color="#ff8a3d"/><stop offset="1" stop-color="#c62828"/></radialGradient>
    <path d="M56,8 C70,30 92,42 86,70 C82,92 66,104 56,104 C42,104 24,94 22,72 C20,52 36,44 40,28 C46,42 50,46 54,48 C56,34 54,20 56,8 Z" fill="url(#fg)" stroke="#8e1c15" stroke-width="3" filter="url(#roughSoft)"/>
    <path d="M56,56 C64,66 70,74 66,86 C62,96 50,96 46,88 C42,78 50,70 56,56 Z" fill="#fff3c4" opacity="0.85"/>`);
}

/** 圆形朱砂印章 + 白色书法字（右侧悬浮按钮）。 */
function sealRound(ch) {
  return svg(112, 112, `
    <circle cx="57" cy="59" r="46" fill="#000" opacity="0.25" filter="url(#blur4)"/>
    <circle cx="56" cy="56" r="46" fill="${C.cinnabar}" filter="url(#rough)"/>
    <circle cx="56" cy="56" r="38" fill="none" stroke="#f3e6d0" stroke-width="2.5" opacity="0.85" filter="url(#roughSoft)"/>
    <text x="56" y="58" text-anchor="middle" dominant-baseline="central" font-family="${BRUSH}" font-size="54" fill="#f7ecd8">${ch}</text>`);
}

/** 方印页签：on 为朱砂底白字，off 为宣纸底墨字。 */
function sealSquare(ch, on) {
  const fill = on ? C.cinnabar : '#2a2621';
  const textColor = on ? '#f7ecd8' : '#b8ab92';
  const stroke = on ? '#f3e6d0' : '#6b6357';
  return svg(104, 104, `
    <rect x="10" y="10" width="84" height="84" rx="10" fill="${fill}" filter="url(#rough)"/>
    <rect x="18" y="18" width="68" height="68" rx="6" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.8"/>
    <text x="52" y="55" text-anchor="middle" dominant-baseline="central" font-family="${BRUSH}" font-size="52" fill="${textColor}">${ch}</text>`);
}

// ---------------------------------------------------------------- 异兽水墨头像
function beastPortrait(b, seed) {
  const s = 256;
  const c = s / 2;
  const el = BEASTS.elements[b.element].color;
  const r = rng(seed);
  let splat = '';
  for (let i = 0; i < 10; i++) {
    const a = r() * Math.PI * 2;
    const d = 92 + r() * 22;
    splat += `<circle cx="${(c + Math.cos(a) * d).toFixed(1)}" cy="${(c + Math.sin(a) * d).toFixed(1)}" r="${(1.5 + r() * 5).toFixed(1)}" fill="${el}" opacity="${(0.35 + r() * 0.45).toFixed(2)}"/>`;
  }
  const inkChar = '#1b1712';
  const name = b.name.length > 3 ? b.name.slice(0, 3) : b.name;
  return svg(s, s, `
    <radialGradient id="washG" cx="0.42" cy="0.38" r="0.62">
      <stop offset="0" stop-color="${C.paperLight}" stop-opacity="1"/>
      <stop offset="0.45" stop-color="${el}" stop-opacity="0.45"/>
      <stop offset="0.8" stop-color="${el}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${el}" stop-opacity="0.95"/>
    </radialGradient>
    <circle cx="${c}" cy="${c}" r="100" fill="${C.paperLight}" filter="url(#rough)"/>
    <circle cx="${c}" cy="${c}" r="100" fill="url(#washG)" filter="url(#wash)"/>
    <circle cx="${c}" cy="${c}" r="98" fill="none" stroke="${C.ink}" stroke-width="3" opacity="0.55" filter="url(#rough)"/>
    <circle cx="${c}" cy="${c}" r="100" filter="url(#paperNoise)"/>
    ${splat}
    <text x="${c - 6}" y="${c + 2}" text-anchor="middle" dominant-baseline="central" font-family="${BRUSH}" font-size="140" fill="#ffffff" opacity="0.6" filter="url(#blur4)">${b.glyph}</text>
    <text x="${c - 6}" y="${c}" text-anchor="middle" dominant-baseline="central" font-family="${BRUSH}" font-size="136" fill="${inkChar}">${b.glyph}</text>
    <text x="${c + 70}" y="${c + 22}" text-anchor="middle" font-family="${BRUSH}" font-size="22" fill="${inkChar}" opacity="0.85" writing-mode="tb">${name}</text>
    <rect x="${c + 60}" y="${c + 62}" width="20" height="20" rx="2" fill="${C.cinnabar}" opacity="0.9" filter="url(#roughSoft)"/>`, seed);
}

// ---------------------------------------------------------------- 清单
const ASSETS = [];
const add = (name, svgText, opts = {}) => ASSETS.push({ name, svg: svgText, ...opts });

add('bg_main', mainBg(), { type: 'jpeg' });
add('bg_battle_nanshan', battleBg('nanshan', 101), { type: 'jpeg' });
add('bg_battle_xishan', battleBg('xishan', 202), { type: 'jpeg' });
add('bg_battle_beidongzhong', battleBg('beidongzhong', 303), { type: 'jpeg' });
add('panel_paper', panelPaper(), { inset: [44, 44, 44, 44] });
add('panel_ink', panelInk(), { inset: [40, 40, 40, 40] });
add('btn_red', button('#d2453a', '#8e1c15', '#5c120d'), { inset: [44, 36, 44, 36] });
add('btn_gold', button('#f0d27a', '#b98f2a', '#6d5214', 0.35), { inset: [44, 36, 44, 36] });
add('btn_ink', button('#454b57', '#1f232b', C.gold, 0.15), { inset: [44, 36, 44, 36] });
add('btn_jade', button('#4fbf8e', '#1f6b4c', '#0f3d2b'), { inset: [44, 36, 44, 36] });
add('pill', pill(), { inset: [32, 20, 32, 20] });
add('tab_bar', tabBar(), { inset: [20, 20, 20, 20] });
add('hp_bg', hpBar('bg'), { inset: [9, 6, 9, 6] });
add('hp_green', hpBar('green'), { inset: [8, 6, 8, 6] });
add('hp_red', hpBar('red'), { inset: [8, 6, 8, 6] });
for (const r of Object.keys(RARITY_FRAME)) add(`frame_${r}`, frame(r));
add('icon_gold', iconCoin());
add('icon_ticket', iconTicket());
add('icon_power', iconPower());
add('icon_signin', sealRound('签'));
add('icon_task', sealRound('任'));
add('icon_chest', sealRound('宝'));
add('icon_wild', sealRound('遇'));
const TABS = { battle: '战', beasts: '兽', mountain: '山', book: '鉴', more: '更' };
for (const k of Object.keys(TABS)) {
  add(`tab_${k}_on`, sealSquare(TABS[k], true));
  add(`tab_${k}_off`, sealSquare(TABS[k], false));
}
BEASTS.beasts.forEach((b, i) => add(`beast_${b.id}`, beastPortrait(b, 1000 + i * 17)));

// ---------------------------------------------------------------- 渲染
(async () => {
  const filter = process.argv[2] || '';
  fs.mkdirSync(OUT, { recursive: true });
  const TMP_HTML = path.join(require('os').tmpdir(), 'yushou-art-render.html');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const head = FONT_CSS.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  let n = 0;
  for (const a of ASSETS) {
    if (filter && a.name.indexOf(filter) < 0) continue;
    const m = /width="(\d+)" height="(\d+)"/.exec(a.svg);
    const w = +m[1];
    const h = +m[2];
    await page.setViewportSize({ width: w, height: h });
    fs.writeFileSync(TMP_HTML, `<html><head><meta charset="utf-8">${head}<style>html,body{margin:0;background:transparent}</style></head><body>${a.svg}</body></html>`);
    await page.goto('file://' + TMP_HTML);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const texts = Array.from(document.querySelectorAll('text')).map((t) => t.textContent);
      await Promise.all(texts.map((t) => document.fonts.load(`54px "Ma Shan Zheng"`, t)));
      await Promise.all(texts.map((t) => document.fonts.load(`900 54px "Noto Serif SC"`, t)));
      await document.fonts.ready;
    });
    await page.waitForTimeout(50);
    const type = a.type || 'png';
    const file = path.join(OUT, `${a.name}.${type === 'jpeg' ? 'jpg' : 'png'}`);
    await page.screenshot({ path: file, type, quality: type === 'jpeg' ? 84 : undefined, omitBackground: type === 'png', clip: { x: 0, y: 0, width: w, height: h } });
    n++;
  }
  const manifest = { _doc: '默认皮肤（tools/art/generate.cjs 生成）。inset 为九宫格边距 [左, 上, 右, 下]，用于可拉伸的面板和按钮。', images: {} };
  for (const a of ASSETS) if (a.inset) manifest.images[a.name] = { inset: a.inset };
  fs.writeFileSync(path.join(OUT, 'skin.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`生成 ${n} 张素材 → ${path.relative(ROOT, OUT)}`);
})();
