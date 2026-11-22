#!/usr/bin/env node
/**
 * 《御兽山海》Q 版界面元素生成器。
 *
 * 用代码画 SVG，再用无头 Chromium 渲染成 PNG，输出到 client/assets/resources/skin/：
 * 按钮、面板、血条、头像框、图标、页签（这些需要精确尺寸和九宫格拉伸，适合用代码画）。
 * 异兽立绘和战斗背景由 ChatGPT 出图、tools/art/import.py 导入，本脚本不生成也不覆盖它们。
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
  '@fontsource/zcool-kuaile/index.css',
  '@fontsource/ma-shan-zheng/index.css',
  '@fontsource/zcool-xiaowei/index.css',
  '@fontsource/noto-serif-sc/900.css',
].map((p) => 'file://' + path.join(ROOT, 'node_modules', p));

// ---------------------------------------------------------------- Q 版界面元素
// 只生成"界面元素"（按钮、面板、血条、头像框、图标、页签）。
// 异兽立绘和战斗背景由 ChatGPT 出图，经 tools/art/import.py 导入，这里**不会**生成或覆盖它们。
const OL = '#4a2f27';
const SW = 5;
const svg = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const ROUND = "'ZCOOL KuaiLe','Noto Serif SC',sans-serif";

function button(top, bot, dark) {
  return svg(240, 104, `
    <rect x="6" y="16" width="228" height="82" rx="36" fill="${dark}" stroke="${OL}" stroke-width="${SW}"/>
    <rect x="6" y="6" width="228" height="82" rx="36" fill="url(#g)" stroke="${OL}" stroke-width="${SW}"/>
    <rect x="26" y="15" width="150" height="20" rx="10" fill="#fff" opacity="0.45"/>
    <circle cx="200" cy="25" r="6" fill="#fff" opacity="0.6"/>`,
    `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`);
}
const panelCream = () => svg(200, 200, `<rect x="5" y="5" width="190" height="190" rx="36" fill="#fff8ea" stroke="${OL}" stroke-width="${SW}"/>
  <rect x="18" y="18" width="164" height="164" rx="26" fill="none" stroke="#f0c98f" stroke-width="3" stroke-dasharray="10 8"/>`);
const panelDark = () => svg(200, 200, `<rect x="5" y="5" width="190" height="190" rx="36" fill="#3d2a24" fill-opacity="0.92" stroke="${OL}" stroke-width="${SW}"/>
  <rect x="16" y="16" width="168" height="168" rx="26" fill="none" stroke="#ffd27a" stroke-width="2.5" opacity="0.6"/>`);
const pill = () => svg(220, 64, `<rect x="3" y="3" width="214" height="58" rx="29" fill="#fffaf0" stroke="${OL}" stroke-width="4"/>`);
const tabBar = () => svg(300, 170, `<rect x="0" y="6" width="300" height="164" fill="#fffaf0"/><rect x="0" y="0" width="300" height="8" fill="${OL}"/>
  <rect x="0" y="12" width="300" height="4" fill="#f0c98f" opacity="0.8"/>`);
const hpBar = (kind) => {
  if (kind === 'bg') return svg(120, 24, `<rect x="2" y="2" width="116" height="20" rx="10" fill="#fff" stroke="${OL}" stroke-width="4"/>`);
  const [a, b] = kind === 'green' ? ['#8ef0b0', '#3fcf7f'] : ['#ff9a8a', '#ff5a5a'];
  return svg(120, 16, `<linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <rect x="0" y="0" width="120" height="16" rx="8" fill="url(#h)"/><rect x="8" y="3" width="70" height="4" rx="2" fill="#fff" opacity="0.5"/>`);
};
const RARITY = { fan: '#d8d0c4', ling: '#7cc4ff', xi: '#c39bff', chuanshuo: '#ffd84d' };
function frame(r) {
  const c = RARITY[r];
  const star = (x, y, k) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0,-14 Q2,-2 14,0 Q2,2 0,14 Q-2,2 -14,0 Q-2,-2 0,-14 Z" fill="#ffd84d" stroke="${OL}" stroke-width="2.5"/>`;
  const extra = r === 'chuanshuo' ? star(150, 30, 1.1) + star(28, 150, 0.8) : r === 'xi' ? star(150, 30, 0.8) : '';
  return svg(180, 180, `<circle cx="90" cy="90" r="80" fill="none" stroke="${OL}" stroke-width="16"/>
    <circle cx="90" cy="90" r="80" fill="none" stroke="${c}" stroke-width="8"/>
    <path d="M42,40 A68,68 0 0 1 90,22" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.7"/>${extra}`);
}
const coin = () => svg(112, 112, `<circle cx="56" cy="58" r="44" fill="#f5b82e" stroke="${OL}" stroke-width="${SW}"/><circle cx="56" cy="54" r="40" fill="#ffd84d"/>
  <circle cx="56" cy="54" r="30" fill="none" stroke="#e8a317" stroke-width="4"/><rect x="45" y="43" width="22" height="22" rx="4" fill="#e8a317" stroke="${OL}" stroke-width="3.5"/>
  <ellipse cx="38" cy="34" rx="9" ry="5" fill="#fff" opacity="0.8" transform="rotate(-35 38 34)"/>`);
const ticket = () => svg(112, 112, `<g transform="rotate(-12 56 56)"><rect x="30" y="10" width="52" height="92" rx="10" fill="#ffe27a" stroke="${OL}" stroke-width="${SW}"/>
  <path d="M56,24 C42,34 70,40 54,52 C40,62 70,68 56,80" stroke="#ff5a5a" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="56" cy="90" r="6" fill="#ff5a5a"/></g>`);
const flame = () => svg(112, 112, `<path d="M56,8 C72,30 94,44 88,72 C84,94 68,104 56,104 C42,104 22,94 22,72 C20,52 36,44 40,28 C46,42 50,46 54,48 C56,34 54,20 56,8 Z" fill="#ff6b4a" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="M56,54 C66,66 72,76 66,88 C62,96 50,96 46,88 C42,78 50,68 56,54 Z" fill="#ffd84d"/>`);
/** 经验：一颗青绿色灵气珠。 */
const expOrb = () => svg(112, 112, `<radialGradient id="o" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#e9fff4"/><stop offset="0.45" stop-color="#7ff0c0"/><stop offset="1" stop-color="#21b38a"/></radialGradient>
  <circle cx="56" cy="58" r="42" fill="url(#o)" stroke="${OL}" stroke-width="${SW}"/>
  <path d="M40,66 C40,46 66,44 66,58 C66,68 52,70 50,62 C48,56 56,54 58,58" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
  <ellipse cx="40" cy="38" rx="9" ry="5" fill="#fff" opacity="0.85" transform="rotate(-35 40 38)"/>`);
/** 挂机宝箱（full 为攒满时发光）。 */
const chestBox = (full) => svg(150, 150, `<radialGradient id="glow"><stop offset="0" stop-color="#fff3a8" stop-opacity="0.95"/><stop offset="1" stop-color="#fff3a8" stop-opacity="0"/></radialGradient>
  ${full ? '<circle cx="75" cy="70" r="72" fill="url(#glow)"/>' : ''}
  <path d="M22,70 L128,70 L122,128 Q75,136 28,128 Z" fill="#c9773b" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="M22,70 Q22,34 75,32 Q128,34 128,70 Z" fill="#e8964f" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="M48,34 L48,128 M102,34 L102,128" stroke="#ffd84d" stroke-width="9"/><path d="M48,34 L48,128 M102,34 L102,128" stroke="${OL}" stroke-width="2" opacity="0.4"/>
  <rect x="20" y="64" width="110" height="14" rx="6" fill="#ffd84d" stroke="${OL}" stroke-width="4"/>
  <rect x="63" y="62" width="24" height="30" rx="6" fill="#ffe27a" stroke="${OL}" stroke-width="4"/><circle cx="75" cy="76" r="4" fill="${OL}"/>
  <ellipse cx="44" cy="46" rx="12" ry="5" fill="#fff" opacity="0.5" transform="rotate(-20 44 46)"/>
  ${full ? '<path d="M118,26 l4,10 10,4 -10,4 -4,10 -4,-10 -10,-4 10,-4z M30,22 l3,7 7,3 -7,3 -3,7 -3,-7 -7,-3 7,-3z" fill="#fff" stroke="#ffb020" stroke-width="2"/>' : ''}`);
/** 装备部位图标：兽爪、鳞甲、灵铃、护符。 */
const equipIcon = (k) => {
  const body = [
    `<path d="M36,88 C30,62 40,38 52,26 M56,90 C52,64 58,40 70,28 M76,90 C76,68 80,50 90,40" fill="none" stroke="${OL}" stroke-width="14" stroke-linecap="round"/><path d="M36,88 C30,62 40,38 52,26 M56,90 C52,64 58,40 70,28 M76,90 C76,68 80,50 90,40" fill="none" stroke="#f3efe6" stroke-width="7" stroke-linecap="round"/>`,
    `<path d="M56,18 L90,30 L86,70 Q74,92 56,98 Q38,92 26,70 L22,30 Z" fill="#7cc4ff" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/><path d="M38,44 Q56,54 74,44 M36,62 Q56,72 76,62 M42,80 Q56,88 70,80" fill="none" stroke="${OL}" stroke-width="3.5" opacity="0.7"/>`,
    `<path d="M56,18 L56,28" stroke="${OL}" stroke-width="6" stroke-linecap="round"/><path d="M30,76 Q30,32 56,28 Q82,32 82,76 Z" fill="#ffd84d" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/><rect x="24" y="72" width="64" height="12" rx="6" fill="#e8a317" stroke="${OL}" stroke-width="4"/><circle cx="56" cy="92" r="8" fill="#ff5a5a" stroke="${OL}" stroke-width="4"/>`,
    `<rect x="32" y="16" width="48" height="84" rx="8" fill="#ffe27a" stroke="${OL}" stroke-width="${SW}"/><path d="M56,28 C44,38 68,44 54,56 C42,66 68,72 56,84" stroke="#ff5a5a" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  ][k];
  return svg(112, 112, body);
};
const bag = () => svg(112, 112, `<path d="M40,30 Q56,14 72,30" fill="none" stroke="${OL}" stroke-width="7" stroke-linecap="round"/>
  <path d="M24,44 Q24,32 36,32 L76,32 Q88,32 88,44 L94,90 Q94,100 84,100 L28,100 Q18,100 18,90 Z" fill="#c9773b" stroke="${OL}" stroke-width="${SW}" stroke-linejoin="round"/>
  <rect x="44" y="52" width="24" height="18" rx="5" fill="#ffd84d" stroke="${OL}" stroke-width="4"/><ellipse cx="38" cy="46" rx="9" ry="4" fill="#fff" opacity="0.5"/>`);
/** 卡片（九宫格）：白底 + 棕色描边 + 内侧细线；dim 为未开放的灰卡。 */
const card = (dim) => svg(120, 120, `<rect x="4" y="8" width="112" height="108" rx="24" fill="${OL}" opacity="0.25"/>
  <rect x="4" y="4" width="112" height="108" rx="24" fill="${dim ? '#ece4d8' : '#ffffff'}" stroke="${OL}" stroke-width="4"/>
  <rect x="12" y="12" width="96" height="92" rx="17" fill="none" stroke="${dim ? '#d3c7b6' : '#f0c98f'}" stroke-width="2.5"/>`);
/** 横幅（九宫格）：奶油色底 + 金边。 */
const banner = () => svg(160, 90, `<rect x="4" y="9" width="152" height="77" rx="18" fill="${OL}" opacity="0.35"/>
  <rect x="4" y="4" width="152" height="77" rx="18" fill="#fffaf0" stroke="${OL}" stroke-width="5"/>
  <rect x="12" y="11" width="136" height="63" rx="12" fill="none" stroke="#f0c98f" stroke-width="3"/>`);
/** 地图关卡点：已通关（金）、下一关（红）、未开放（灰）。 */
const mapNode = (kind) => {
  const c = { done: ['#fff3b0', '#ffc43d', '#e8a317', OL], next: ['#ffb3a6', '#ff5a5a', '#d93f3f', OL], lock: ['#f6f1ea', '#d8cfc2', '#c4b8a8', '#8a7a68'] }[kind];
  return svg(100, 100, `<radialGradient id="n" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="${c[0]}"/><stop offset="0.6" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></radialGradient>
    <circle cx="50" cy="56" r="42" fill="${OL}" opacity="0.35"/><circle cx="50" cy="50" r="42" fill="url(#n)" stroke="${c[3]}" stroke-width="5"/>
    <ellipse cx="36" cy="30" rx="11" ry="6" fill="#fff" opacity="0.6" transform="rotate(-30 36 30)"/>`);
};
const checkBadge = () => svg(48, 48, `<circle cx="24" cy="24" r="20" fill="#3fcf7f" stroke="#2a7a52" stroke-width="4"/><path d="M14,25 L21,32 L34,17" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);
const lockIcon = () => svg(64, 64, `<path d="M20,30 L20,22 Q20,10 32,10 Q44,10 44,22 L44,30" fill="none" stroke="${OL}" stroke-width="6"/><rect x="12" y="28" width="40" height="30" rx="7" fill="#ffc43d" stroke="${OL}" stroke-width="4"/><circle cx="32" cy="42" r="4" fill="${OL}"/>`);
const mapTree = (c1, c2) => svg(80, 100, `<rect x="34" y="58" width="12" height="34" rx="5" fill="#9a6b45" stroke="${OL}" stroke-width="3.5"/>
  <circle cx="40" cy="42" r="32" fill="${c1}" stroke="${OL}" stroke-width="3.5"/><circle cx="30" cy="32" r="10" fill="${c2}"/>`);
const mapPeak = (c) => svg(220, 150, `<path d="M6,144 L110,10 L214,144 Z" fill="${c}" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M82,46 L110,10 L138,46 L124,52 L110,40 L96,54 Z" fill="#fff" stroke="${OL}" stroke-width="2.5" stroke-linejoin="round"/>`);
const mapCloud = () => svg(160, 80, `<g opacity="0.92"><ellipse cx="82" cy="52" rx="66" ry="24" fill="#fff"/><ellipse cx="50" cy="38" rx="32" ry="24" fill="#fff"/><ellipse cx="98" cy="30" rx="38" ry="28" fill="#fff"/></g>`);
const mapHouse = () => svg(120, 100, `<rect x="26" y="44" width="68" height="48" fill="#e8964f" stroke="${OL}" stroke-width="4"/>
  <path d="M8,48 L60,10 L112,48 Z" fill="#c0392b" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/><rect x="50" y="62" width="20" height="30" fill="${OL}"/>`);
/** 圆形彩色图标底 + 白字（右侧悬浮按钮）。 */
const roundIcon = (bg, ch) => svg(112, 112, `<circle cx="56" cy="62" r="46" fill="${OL}"/><circle cx="56" cy="56" r="46" fill="${bg}" stroke="${OL}" stroke-width="${SW}"/>
  <ellipse cx="36" cy="34" rx="11" ry="6" fill="#fff" opacity="0.5" transform="rotate(-30 36 34)"/>
  <text x="56" y="60" text-anchor="middle" dominant-baseline="central" font-family="${ROUND}" font-size="50" fill="#fff" stroke="${OL}" stroke-width="7" paint-order="stroke">${ch}</text>`);
const tabIcon = (bg, glyph, on) => svg(110, 110, `<circle cx="55" cy="60" r="44" fill="${OL}"/><circle cx="55" cy="54" r="44" fill="${on ? bg : '#d9cfc2'}" stroke="${OL}" stroke-width="${SW}"/>
  <ellipse cx="38" cy="32" rx="11" ry="6" fill="#fff" opacity="0.5" transform="rotate(-30 38 32)"/><g opacity="${on ? 1 : 0.75}">${glyph}</g>`);
const swords = `<path d="M34,76 L74,32 M36,32 L76,76" stroke="${OL}" stroke-width="12" stroke-linecap="round"/><path d="M34,76 L74,32 M36,32 L76,76" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`;
const paw = `<circle cx="55" cy="64" r="15" fill="#fff" stroke="${OL}" stroke-width="4"/>` + [[35, 44], [48, 34], [62, 34], [75, 44]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5" fill="#fff" stroke="${OL}" stroke-width="3.5"/>`).join('');
const mount = `<path d="M22,78 L46,40 L58,56 L68,44 L90,78 Z" fill="#fff" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/><path d="M40,50 L46,40 L52,49" fill="#bfe9ff"/>`;
const book = `<path d="M28,36 Q42,30 55,38 Q68,30 82,36 L82,76 Q68,70 55,78 Q42,70 28,76 Z" fill="#fff" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/><path d="M55,38 L55,78" stroke="${OL}" stroke-width="3"/>`;
const dots = [36, 55, 74].map((x) => `<circle cx="${x}" cy="54" r="7" fill="#fff" stroke="${OL}" stroke-width="3.5"/>`).join('');

// ---------------------------------------------------------------- 清单
const ASSETS = [];
const add = (name, svgText, opts = {}) => ASSETS.push({ name, svg: svgText, ...opts });
add('panel_paper', panelCream(), { inset: [56, 56, 56, 56] });
add('panel_ink', panelDark(), { inset: [56, 56, 56, 56] });
add('btn_red', button('#ff8a7a', '#ff5a5a', '#d93f3f'), { inset: [48, 40, 48, 44] });
add('btn_gold', button('#ffe27a', '#ffc43d', '#e8a317'), { inset: [48, 40, 48, 44] });
add('btn_ink', button('#9ad8ff', '#4fb2ff', '#2f8ee0'), { inset: [48, 40, 48, 44] });
add('btn_jade', button('#8ef0b0', '#3fcf7f', '#2aa864'), { inset: [48, 40, 48, 44] });
add('pill', pill(), { inset: [32, 24, 32, 24] });
add('tab_bar', tabBar(), { inset: [10, 30, 10, 30] });
add('hp_bg', hpBar('bg'), { inset: [12, 10, 12, 10] });
add('hp_green', hpBar('green'), { inset: [8, 7, 8, 7] });
add('hp_red', hpBar('red'), { inset: [8, 7, 8, 7] });
for (const r of Object.keys(RARITY)) add(`frame_${r}`, frame(r));
add('icon_gold', coin());
add('icon_ticket', ticket());
add('icon_power', flame());
add('icon_exp', expOrb());
add('chest_box', chestBox(false));
add('chest_box_full', chestBox(true));
for (let k = 0; k < 4; k++) add(`equip_${k}`, equipIcon(k));
add('icon_bag', bag());
add('card', card(false), { inset: [36, 36, 36, 36] });
add('card_dim', card(true), { inset: [36, 36, 36, 36] });
add('banner', banner(), { inset: [30, 28, 30, 28] });
for (const k of ['done', 'next', 'lock']) add(`node_${k}`, mapNode(k));
add('badge_check', checkBadge());
add('icon_lock', lockIcon());
add('map_tree', mapTree('#7cc47a', '#a6e09b'));
add('map_tree_autumn', mapTree('#f0a04b', '#ffd08a'));
add('map_tree_snow', mapTree('#9cc6d8', '#ffffff'));
add('map_peak', mapPeak('#a9c7d8'));
add('map_cloud', mapCloud());
add('map_house', mapHouse());
add('icon_signin', roundIcon('#ff7b7b', '签'));
add('icon_task', roundIcon('#7cc4ff', '任'));
add('icon_chest', roundIcon('#ffc43d', '宝'));
add('icon_wild', roundIcon('#6fd39a', '遇'));
const TABS = { battle: ['#ff7b7b', swords], beasts: ['#ffb347', paw], mountain: ['#6fd39a', mount], book: ['#7cc4ff', book], more: ['#c39bff', dots] };
for (const k of Object.keys(TABS)) {
  add(`tab_${k}_on`, tabIcon(TABS[k][0], TABS[k][1], true));
  add(`tab_${k}_off`, tabIcon(TABS[k][0], TABS[k][1], false));
}

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
      await Promise.all(texts.map((t) => document.fonts.load(`54px "ZCOOL KuaiLe"`, t)));
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
