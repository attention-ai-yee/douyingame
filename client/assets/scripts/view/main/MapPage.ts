import { EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { App } from '../../app/App';
import { formatNumber } from '../../core';
import { makeBeastIcon } from '../ui/BeastIcon';
import { makeSprite, setSprite } from '../ui/Skin';
import { hex, makeLabel, setLabel, uiNode } from '../ui/UiKit';
import { alignedLabel, redDot, skinButton, SkinButton } from '../ui/Widgets';
import { registerGuideTarget } from './GuideView';
import { Page, PageHost } from './Pages';

const OL = '#4a2f27';
const SPACING = 96;
const PAD_BOTTOM = 220;
const PAD_TOP = 420;

/** 每座山的配色：地面两种绿（或秋色、雪色）、树。 */
const THEMES: Record<string, { paper: string; land: [string, string]; river: string; tree: string; peak: string }> = {
  nanshan: { paper: '#f4e6c4', land: ['#c8e6a0', '#b5d88a'], river: '#9fd3f0', tree: 'map_tree', peak: '#a9c7d8' },
  xishan: { paper: '#f6e2c0', land: ['#f2d49a', '#e8c27e'], river: '#a9d8e8', tree: 'map_tree_autumn', peak: '#d6b48a' },
  beidongzhong: { paper: '#eef2f4', land: ['#dfeaf0', '#cfdde6'], river: '#b9e0f2', tree: 'map_tree_snow', peak: '#b7cbd8' },
};

/** 确定性的伪随机，地图每次画出来都一样。 */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 进山（游戏设计文档 13.5）：顶部切换山脉 / 镇妖塔；中间是这座山的地图——
 * 山、河、树、云和一条弯弯的小路，40 个关卡点从下往上排，可以上下拖动；
 * 底部卡片显示选中关卡的敌我战力、敌人、首通奖励和「挑战」按钮。
 */
export class MapPage implements Page {
  node: Node;
  private chapter = 1;
  private tower = false;
  private header: Node;
  private tabs: Node[] = [];
  private progressBar: Graphics;
  private progressL: Label;
  private bossL: Label;
  private view: Node;
  private content: Node | null = null;
  private scroll = 0;
  private minScroll = 0;
  private maxScroll = 0;
  private marker: Node | null = null;
  private markerY = 0;
  private t = 0;
  private card: Node;
  private cardBody: Node;
  private challenge: SkinButton;
  private selected = 0;
  private sig = '';

  constructor(private host: PageHost, parent: Node, private w: number, private h: number, y: number) {
    this.node = uiNode('MapPage', parent, 0, y);
    const ut = this.node.addComponent(UITransform);
    ut.setContentSize(w, h);
    this.node.on(Node.EventType.TOUCH_START, () => undefined);
    // 地图（最底层，可拖动）
    this.view = uiNode('View', this.node);
    this.node.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.drag(e.getUIDelta().y));
    // 顶部：山脉切换 + 进度
    this.header = uiNode('Header', this.node, 0, h / 2 - 80);
    const hb = this.header.addComponent(Graphics);
    hb.fillColor = hex('#fffaf0');
    hb.rect(-w / 2, -80, w, 160);
    hb.fill();
    hb.fillColor = hex('#e3c999');
    hb.rect(-w / 2, -84, w, 4);
    hb.fill();
    const names = App.cfg.stages.chapters.map((c) => c.name.split('·')[0]).concat(['镇妖塔']);
    const tw = (w - 40) / names.length;
    names.forEach((name, i) => {
      const n = makeSprite(this.header, 'btn_ink', tw - 10, 66, -w / 2 + 20 + tw * i + tw / 2, 34, { fallback: '#2a2e36' });
      makeLabel(n, name.length > 4 ? name.slice(0, 3) : name, 26, '#ffffff', 0, 4);
      n.on(Node.EventType.TOUCH_END, () => this.pick(i));
      this.tabs.push(n);
    });
    this.progressL = alignedLabel(this.header, '', 22, OL, -w / 2 + 26, -30, 'left');
    this.progressBar = uiNode('Bar', this.header, 0, -30).addComponent(Graphics);
    this.bossL = alignedLabel(this.header, '', 21, '#b3261e', w / 2 - 26, -30, 'right');
    // 底部：关卡卡片
    this.card = makeSprite(this.node, 'card', w - 36, 176, 0, -h / 2 + 100, { fallback: '#ffffff' });
    this.cardBody = uiNode('Body', this.card);
    this.challenge = skinButton(this.card, 'btn_red', '挑 战', 230, 104, () => this.onChallenge(), w / 2 - 150, 0);
    registerGuideTarget('stage_challenge', this.challenge.node, 'mountain');
    // 默认打开玩家正在打的那座山
    this.chapter = Math.min(App.core.f.chapterOfStage(App.core.state.stage + 1), App.cfg.stages.chapters.length);
  }

  private unlocked(ch: number): boolean {
    return App.core.state.stage >= (ch - 1) * App.cfg.stages.chapterLength;
  }

  private pick(i: number): void {
    const chs = App.cfg.stages.chapters.length;
    if (i === chs) {
      if (!App.core.towerUnlocked()) {
        this.host.toast(`打通南山经（第 ${App.cfg.stages.tower.unlockStage} 关）后开放镇妖塔`);
        return;
      }
      this.tower = true;
    } else {
      if (!this.unlocked(i + 1)) {
        this.host.toast('打通上一座山后开放');
        return;
      }
      this.tower = false;
      this.chapter = i + 1;
      this.selected = 0;
    }
    this.sig = '';
    this.refresh();
  }

  refresh(): void {
    const core = App.core;
    const sig = `${this.chapter}|${this.tower}|${core.state.stage}|${core.state.floor}|${Math.round(core.teamPower())}|${this.selected}`;
    this.animate();
    if (sig === this.sig) return;
    const rebuildMap = !this.sig || this.sig.split('|').slice(0, 4).join('|') !== sig.split('|').slice(0, 4).join('|');
    this.sig = sig;
    this.refreshHeader();
    if (rebuildMap) this.buildMap();
    this.refreshCard();
  }

  // ------------------------------------------------------------ 顶部

  private refreshHeader(): void {
    const core = App.core;
    const chs = App.cfg.stages.chapters;
    this.tabs.forEach((n, i) => {
      const on = this.tower ? i === chs.length : i === this.chapter - 1;
      const open = i === chs.length ? core.towerUnlocked() : this.unlocked(i + 1);
      setSprite(n, on ? 'btn_red' : 'btn_ink', (this.w - 40) / this.tabs.length - 10, 66, { fallback: on ? '#b3261e' : '#2a2e36', color: open ? undefined : '#b8ada0' });
    });
    const len = App.cfg.stages.chapterLength;
    let frac: number;
    if (this.tower) {
      setLabel(this.progressL, `已镇压 ${core.state.floor} 层`);
      setLabel(this.bossL, '每 5 层寻兽符 · 每 10 层万能星魄');
      frac = 0;
    } else {
      const cleared = Math.max(0, Math.min(len, core.state.stage - (this.chapter - 1) * len));
      setLabel(this.progressL, `已通关 ${cleared}/${len}`);
      setLabel(this.bossL, `Boss：${chs[this.chapter - 1].boss.name}`);
      frac = cleared / len;
    }
    const g = this.progressBar;
    g.clear();
    const bw = 250;
    const x0 = -this.w / 2 + 190;
    if (!this.tower) {
      g.fillColor = hex('#efe7db');
      g.roundRect(x0, -11, bw, 22, 11);
      g.fill();
      g.lineWidth = 3;
      g.strokeColor = hex(OL);
      g.roundRect(x0, -11, bw, 22, 11);
      g.stroke();
      if (frac > 0) {
        g.fillColor = hex('#ffc43d');
        g.roundRect(x0 + 3, -8, Math.max(16, (bw - 6) * frac), 16, 8);
        g.fill();
      }
    }
  }

  // ------------------------------------------------------------ 地图

  private stagePos(k: number): { x: number; y: number } {
    // 小路左右摆动，每 8 关一个大弯
    const x = 230 * Math.sin((k - 1) * 0.62) + 40 * Math.sin((k - 1) * 1.7);
    return { x, y: PAD_BOTTOM + (k - 1) * SPACING };
  }

  private buildMap(): void {
    if (this.content) this.content.destroy();
    this.marker = null;
    const content = uiNode('Content', this.view);
    this.content = content;
    if (this.tower) {
      this.buildTower(content);
      this.scroll = 0;
      this.minScroll = this.maxScroll = 0;
      content.setPosition(0, 0);
      return;
    }
    const core = App.core;
    const len = App.cfg.stages.chapterLength;
    const ch = App.cfg.stages.chapters[this.chapter - 1];
    const th = THEMES[ch.mountain] || THEMES.nanshan;
    const W = this.w;
    const total = PAD_BOTTOM + (len - 1) * SPACING + PAD_TOP;
    const r = rand(this.chapter * 7919);
    // 底色和地面
    const g = uiNode('Land', content).addComponent(Graphics);
    g.fillColor = hex(th.paper);
    g.rect(-W / 2, 0, W, total);
    g.fill();
    for (let band = 0, y = 0; y < total - 200; band++, y += 620) {
      g.fillColor = hex(th.land[band % 2]);
      g.moveTo(-W / 2 - 10, y);
      for (let x = -W / 2 - 10; x <= W / 2 + 10; x += 25) g.lineTo(x, y + 420 + 50 * Math.sin(x / 90 + band * 1.3));
      g.lineTo(W / 2 + 10, y);
      g.close();
      g.fill();
      g.lineWidth = 3;
      g.strokeColor = hex(OL, 120);
      g.moveTo(-W / 2 - 10, y + 420 + 50 * Math.sin((-W / 2 - 10) / 90 + band * 1.3));
      for (let x = -W / 2 - 10; x <= W / 2 + 10; x += 25) g.lineTo(x, y + 420 + 50 * Math.sin(x / 90 + band * 1.3));
      g.stroke();
    }
    // 河：从右下斜穿到左上，两条
    for (const ry of [total * 0.28, total * 0.66]) {
      const pts: { x: number; y: number }[] = [];
      for (let x = W / 2 + 20; x >= -W / 2 - 20; x -= 20) pts.push({ x, y: ry + (W / 2 - x) * 0.35 + 40 * Math.sin(x / 70) });
      this.polyline(g, pts, 64, hex(OL, 200));
      this.polyline(g, pts, 56, hex(th.river));
      this.polyline(g, pts.filter((_, i) => i % 3 === 0).slice(0, 12), 4, hex('#ffffff', 200));
    }
    // 小路（先描边，再填土色，中间一条虚线）
    const path: { x: number; y: number }[] = [{ x: this.stagePos(1).x - 40, y: 60 }];
    for (let k = 1; k <= len; k++) path.push(this.stagePos(k));
    path.push({ x: 0, y: total - 90 });
    const smooth = this.catmull(path, 8);
    this.polyline(g, smooth, 36, hex(OL, 220));
    this.polyline(g, smooth, 28, hex('#e8cf98'));
    for (let i = 0; i < smooth.length - 1; i += 2) this.polyline(g, [smooth[i], smooth[i + 1]], 5, hex('#fff6df'));
    // 远山、小庙（在 Boss 上方）、云
    const deco = uiNode('Deco', content);
    makeSprite(deco, 'map_peak', 260, 178, -190, total - 150, { optional: true, color: th.peak === '#a9c7d8' ? undefined : th.peak });
    makeSprite(deco, 'map_peak', 300, 205, 200, total - 130, { optional: true });
    makeSprite(deco, 'map_house', 120, 100, 0, total - 60, { optional: true });
    // 树：随机撒在小路两边，不挡路
    for (let i = 0; i < 46; i++) {
      const y = 120 + r() * (total - 380);
      const k = Math.max(1, Math.min(len, Math.round((y - PAD_BOTTOM) / SPACING) + 1));
      const px = this.stagePos(k).x;
      let x = -W / 2 + 40 + r() * (W - 80);
      if (Math.abs(x - px) < 120) x = px + (x < px ? -130 : 130);
      if (Math.abs(x) > W / 2 - 30) continue;
      const s = 0.7 + r() * 0.5;
      makeSprite(deco, th.tree, 70 * s, 88 * s, x, y, { optional: true });
    }
    for (let i = 0; i < 6; i++) makeSprite(deco, 'map_cloud', 170, 85, (i % 2 ? 1 : -1) * (200 + r() * 100), 300 + i * (total / 6), { optional: true, alpha: 220 });
    // 关卡点
    const nodes = uiNode('Nodes', content);
    const from = (this.chapter - 1) * len;
    const next = core.state.stage + 1;
    for (let k = 1; k <= len; k++) {
      const n = from + k;
      const p = this.stagePos(k);
      const done = n <= core.state.stage;
      const isNext = n === next;
      const chapterBoss = core.f.isChapterBoss(n);
      const boss = chapterBoss || core.f.isSmallBoss(n);
      const size = isNext ? 88 : boss ? 86 : 66;
      const node = makeSprite(nodes, done ? 'node_done' : isNext ? 'node_next' : 'node_lock', size, size, p.x, p.y, { fallback: done ? '#ffc43d' : isNext ? '#ff5a5a' : '#d8cfc2' });
      makeLabel(node, String(k), isNext ? 34 : 26, done ? OL : isNext ? '#ffffff' : '#8a7a68', 0, 4);
      node.on(Node.EventType.TOUCH_END, () => {
        this.selected = n;
        this.sig = '';
        this.refresh();
      });
      if (done) makeSprite(nodes, 'badge_check', 30, 30, p.x + size / 2 - 8, p.y + size / 2 - 8, { optional: true });
      if (boss) {
        const bossId = chapterBoss ? ch.boss.captureBeast : null;
        const side = p.x > 0 ? -1 : 1;
        const bx = p.x + side * 96;
        if (bossId) makeBeastIcon(nodes, bossId, 74, bx, p.y + 6, { enemy: !done, frame: 'enemy' });
        else {
          const ring = uiNode('Boss', nodes, bx, p.y + 6).addComponent(Graphics);
          ring.fillColor = hex('#efe2ff');
          ring.circle(0, 0, 34);
          ring.fill();
          ring.lineWidth = 5;
          ring.strokeColor = hex('#b3261e');
          ring.circle(0, 0, 34);
          ring.stroke();
          makeLabel(ring.node, chapterBoss ? '王' : '妖', 32, '#b3261e', 0, 2);
        }
        makeLabel(nodes, chapterBoss ? ch.boss.name : '小 Boss', 20, '#b3261e', bx, p.y - 46);
      } else if (core.f.isTreasure(n) && !done) {
        makeSprite(nodes, 'chest_box', 52, 52, p.x + (p.x > 0 ? -52 : 52), p.y + 26, { optional: true });
      }
      if (isNext) {
        this.markerY = p.y + 92;
        this.marker = uiNode('Marker', nodes, p.x, this.markerY);
        const lead = core.teamIds().slice().sort((a, b) => core.unitPower(b) - core.unitPower(a))[0] || 'lei';
        makeBeastIcon(this.marker, lead, 118, 0, 0, { frame: null });
        const tag = makeSprite(this.marker, 'pill', 108, 42, p.x > 0 ? -104 : 104, 26, { fallback: '#ffffff' });
        makeLabel(tag, '下一关', 22, OL);
        if (core.canBeatNextStage()) redDot(tag, 48, 16);
      }
    }
    // 滚动范围：看得见的窗口是页面中间那段
    const viewTop = this.h / 2 - 160;
    const viewBottom = -this.h / 2 + 190;
    this.maxScroll = viewBottom - 40; // 最底：第 1 关附近贴着底部卡片
    this.minScroll = viewTop - total; // 最顶：Boss 和小庙
    const focusK = Math.max(1, Math.min(len, next - from));
    const focusY = this.stagePos(focusK).y;
    this.scroll = this.clamp(viewBottom + (viewTop - viewBottom) * 0.3 - focusY);
    content.setPosition(0, this.scroll);
  }

  private buildTower(content: Node): void {
    const core = App.core;
    const g = uiNode('Tower', content, 0, 40).addComponent(Graphics);
    g.fillColor = hex('#eef2f4');
    g.rect(-this.w / 2, -this.h / 2, this.w, this.h);
    g.fill();
    // 一座七层小塔
    for (let i = 0; i < 7; i++) {
      const y = -260 + i * 78;
      const half = 150 - i * 14;
      g.fillColor = hex(i % 2 ? '#e8964f' : '#f0a860');
      g.rect(-half + 20, y, (half - 20) * 2, 56);
      g.fill();
      g.lineWidth = 4;
      g.strokeColor = hex(OL);
      g.rect(-half + 20, y, (half - 20) * 2, 56);
      g.stroke();
      g.fillColor = hex('#c0392b');
      g.moveTo(-half - 6, y + 56);
      g.lineTo(half + 6, y + 56);
      g.lineTo(half - 24, y + 78);
      g.lineTo(-half + 24, y + 78);
      g.close();
      g.fill();
      g.stroke();
    }
    makeLabel(g.node, `第 ${core.state.floor + 1} 层`, 34, '#ffffff', 0, -230);
    makeSprite(content, 'map_cloud', 200, 100, -220, 300, { optional: true });
    makeSprite(content, 'map_cloud', 170, 85, 230, 120, { optional: true });
  }

  private clamp(v: number): number {
    return Math.max(this.minScroll, Math.min(this.maxScroll, v));
  }

  private drag(dy: number): void {
    if (!this.content || this.tower) return;
    this.scroll = this.clamp(this.scroll + dy);
    this.content.setPosition(0, this.scroll);
  }

  /** "你在这里"的异兽轻轻跳。 */
  private animate(): void {
    this.t += 0.25;
    if (this.marker) this.marker.setPosition(this.marker.position.x, this.markerY + 6 * Math.sin(this.t * 2));
  }

  private polyline(g: Graphics, pts: { x: number; y: number }[], width: number, color: ReturnType<typeof hex>): void {
    if (pts.length < 2) return;
    g.lineWidth = width;
    g.strokeColor = color;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
    // 线段接头处补圆，粗线拐弯不出尖角
    g.fillColor = color;
    for (const p of pts) {
      g.circle(p.x, p.y, width / 2);
    }
    g.fill();
  }

  /** Catmull-Rom 插值，把关卡点连成平滑的小路。 */
  private catmull(p: { x: number; y: number }[], steps: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(p.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    out.push(p[p.length - 1]);
    return out;
  }

  // ------------------------------------------------------------ 底部卡片

  private refreshCard(): void {
    this.cardBody.destroy();
    this.cardBody = uiNode('Body', this.card);
    const core = App.core;
    const b = this.cardBody;
    const cw = this.w - 36;
    const left = -cw / 2 + 28;
    if (this.tower) {
      const f = core.state.floor + 1;
      const enemy = core.nextFloorPower();
      const ok = core.teamPower() >= enemy;
      alignedLabel(b, `镇妖塔 第 ${f} 层${core.f.isTowerBoss(f) ? ' · 塔主' : ''}`, 32, OL, left, 46, 'left');
      alignedLabel(b, `敌方战力 ${formatNumber(enemy)} · 我方 ${formatNumber(core.teamPower())}${ok ? ' ✓' : ''}`, 22, ok ? '#2f8f68' : '#b3261e', left, 4, 'left');
      const rw = App.cfg.stages.tower.rewards;
      alignedLabel(b, `每 ${rw.ticketsEvery} 层寻兽符 ×${rw.tickets} · 每 ${rw.lingWildEvery} 层灵级万能星魄`, 20, '#8a6d55', left, -40, 'left');
      this.challenge.setText('挑 战');
      this.challenge.setEnabled(true);
      return;
    }
    const len = App.cfg.stages.chapterLength;
    const from = (this.chapter - 1) * len;
    const next = core.nextStage();
    const n = this.selected && this.selected > from && this.selected <= from + len ? this.selected : next && next.chapter === this.chapter ? next.stage : from + len;
    const local = n - from;
    const done = n <= core.state.stage;
    const isNext = !!next && n === next.stage;
    const enemy = core.f.enemyPower(n);
    const ok = core.teamPower() >= enemy;
    const tag = core.f.isChapterBoss(n) ? ` · ${App.cfg.stages.chapters[this.chapter - 1].boss.name}` : core.f.isSmallBoss(n) ? ' · 小 Boss' : core.f.isTreasure(n) ? ' · 宝箱关' : '';
    alignedLabel(b, `第 ${local} 关${tag}`, 32, OL, left, 50, 'left');
    if (done) alignedLabel(b, '已通关', 24, '#2f8f68', left, 8, 'left');
    else alignedLabel(b, `敌方战力 ${formatNumber(enemy)} · 我方 ${formatNumber(core.teamPower())}${ok ? ' ✓' : ''}`, 22, ok ? '#2f8f68' : '#b3261e', left, 8, 'left');
    // 敌人头像
    const m = App.core.idx.mountainOfChapter[this.chapter];
    const pool = m.tiers.fan.map((x) => x[0]).concat(m.tiers.ling.map((x) => x[0]));
    for (let i = 0; i < 3; i++) makeBeastIcon(b, pool[(n * 7 + i * 3) % pool.length], 50, left + 26 + i * 58, -46, { enemy: true, frame: 'enemy' });
    // 首通奖励
    const g = App.cfg.progression.gold;
    const mins = g.firstClearMinutes * (core.f.isTreasure(n) ? g.treasureMult : 1);
    const gold = mins * core.f.goldPerMin(n);
    const exp = mins * core.f.expPerMin(n);
    makeSprite(b, 'icon_gold', 34, 34, left + 210, -46, { optional: true });
    alignedLabel(b, formatNumber(gold), 22, OL, left + 232, -46, 'left');
    makeSprite(b, 'icon_exp', 32, 32, left + 320, -46, { optional: true });
    alignedLabel(b, formatNumber(exp), 22, OL, left + 340, -46, 'left');
    this.challenge.setText(done ? '已通关' : isNext ? '挑 战' : '未开放');
    this.challenge.setEnabled(isNext);
  }

  private onChallenge(): void {
    if (this.tower) {
      this.host.openStage('tower');
      return;
    }
    const next = App.core.nextStage();
    if (!next) return;
    const len = App.cfg.stages.chapterLength;
    const from = (this.chapter - 1) * len;
    if (next.stage <= from || next.stage > from + len) return;
    this.host.openStage('stage');
  }
}
