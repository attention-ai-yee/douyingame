import { _decorator, Component, Graphics, Label, Node } from 'cc';
import { App } from '../../app/App';
import { BeastDef, RevealSession, Rng, ThrowResult } from '../../core';
import { makeSprite, setSprite, Skin } from '../ui/Skin';
import { Button, hex, makeButton, makeFullScreen, makeGraphics, makeLabel, setLabel, strokePolyline, uiNode, visibleSize } from '../ui/UiKit';
import { arcPoints, JUDGE_COLOR, JUDGE_TEXT, polar, sealsText, visualState } from './RevealGeometry';

const { ccclass } = _decorator;

/** 异兽登场动画时长，期间点击无效。 */
const INTRO_MS = 600;
/** 拍完最后一张到弹出结果的间隔。 */
const END_DELAY_MS = 600;
/** 完美时的顿帧。 */
const HIT_STOP_MS = 80;
const SHAKE_MS = 140;
const FEEDBACK_MS = 650;
/** 原生触摸时间戳超过这个"年龄"就不用了（可能是上一次点击留下的）。 */
const TOUCH_MAX_AGE_MS = 150;

export interface RevealOpenOptions {
  beast: BeastDef;
  isBoss: boolean;
  shiny: boolean;
  /** 练习模式：不发奖励，可以切换异兽，结果页显示每拍偏差。 */
  practice: boolean;
  /** 正式模式由调用方传入（GameCore.createRevealSession），练习模式不传。 */
  session?: RevealSession;
  /** 标题上方的小字，例如"野生异兽出现了！" */
  sourceText?: string;
  /** 正式模式：拍完或跳过后结算奖励，返回要显示的奖励文字。 */
  onSettle?: (seals: number, skipped: boolean, throws: ThrowResult[]) => string;
  onClose?: () => void;
  /** 练习模式可切换的异兽列表。 */
  practiceList?: BeastDef[];
}

type Phase = 'intro' | 'play' | 'ending' | 'result';

/**
 * 现身拍符界面（游戏设计文档 5.3）。全部节点由代码创建，打开方式：
 *   RevealView.open(canvasNode, { beast, isBoss, shiny, practice: false, session, onSettle, onClose })
 *
 * 计时：用平台的高精度时钟推进 RevealSession；点击时优先用原生触摸时间戳，
 * 换算成"多少毫秒之前"再回溯判定，所以不受引擎帧率影响。
 */
@ccclass('RevealView')
export class RevealView extends Component {
  static open(parent: Node, opts: RevealOpenOptions): RevealView {
    const n = uiNode('RevealView', parent);
    const v = n.addComponent(RevealView);
    v.setup(opts);
    return v;
  }

  private opts!: RevealOpenOptions;
  private beast!: BeastDef;
  private session!: RevealSession;
  private phase: Phase = 'intro';
  private phaseStart = 0;
  private lastPerf = 0;
  private sessionT = 0;
  private frozenUntil = 0;
  private shakeUntil = 0;
  private lastThrowT = -Infinity;
  private feedbackAt = -1e9;
  private feedbackColor = '#ffffff';
  private radius = 220;
  private W = 750;
  private H = 1334;
  private practiceIndex = 0;

  private root!: Node;
  private beastG!: Graphics;
  private beastArt!: Node;
  private ringG!: Graphics;
  private overlayG!: Graphics;
  private marker!: Node;
  private tag!: Label;
  private title!: Label;
  private sub!: Label;
  private beastLabel!: Label;
  private hint!: Label;
  private sealsLabel!: Label;
  private throwsLabel!: Label;
  private feedback!: Label;
  private bottomBtn: Button | null = null;
  private resultNode: Node | null = null;

  // ------------------------------------------------------------ 搭建

  private setup(opts: RevealOpenOptions): void {
    this.opts = opts;
    const vs = visibleSize();
    this.W = vs.width;
    this.H = vs.height;
    this.radius = Math.round(Math.min(this.W, this.H) * 0.3);
    const r = this.radius;
    const top = this.H / 2;

    const blocker = makeFullScreen(this.node, 'Blocker', '#0b0f1a', 242);
    blocker.on(Node.EventType.TOUCH_START, () => this.onTap());
    makeSprite(blocker, 'bg_reveal', this.W, this.H, 0, 0, { optional: true });

    this.root = uiNode('Root', this.node);
    this.beastG = makeGraphics(this.root, 'Beast');
    this.beastLabel = makeLabel(this.beastG.node, '', 30, '#ffffff');
    this.beastArt = uiNode('Art', this.root);
    this.ringG = makeGraphics(this.root, 'Ring');
    this.marker = uiNode('Marker', this.root);
    if (Skin.has('icon_ticket')) makeSprite(this.marker, 'icon_ticket', 56, 56);
    else {
      const mg = this.marker.addComponent(Graphics);
      mg.fillColor = hex('#f6d365');
      mg.rect(-12, -24, 24, 48);
      mg.fill();
      mg.strokeColor = hex('#c0392b');
      mg.lineWidth = 3;
      mg.moveTo(0, -16);
      mg.lineTo(0, 16);
      mg.stroke();
    }
    this.overlayG = makeGraphics(this.root, 'Overlay');

    this.tag = makeLabel(this.root, '', 26, '#9aa3b2', 0, top - 90);
    this.title = makeLabel(this.root, '', 46, '#ffffff', 0, top - 145);
    this.sub = makeLabel(this.root, '', 24, '#c8cfdb', 0, top - 195);
    this.hint = makeLabel(this.root, '', 32, '#ff8a65', 0, r + 64);
    this.sealsLabel = makeLabel(this.root, '', 56, '#ffd54f', 0, -r - 80);
    this.throwsLabel = makeLabel(this.root, '', 26, '#c8cfdb', 0, -r - 140);
    this.feedback = makeLabel(this.root, '', 64, '#ffffff', 0, r * 0.55);

    if (opts.practice && opts.practiceList && opts.practiceList.length) {
      this.practiceIndex = Math.max(0, opts.practiceList.indexOf(opts.beast));
      makeButton(this.node, '◀', 90, 70, '#37415a', () => this.switchBeast(-1), -this.W / 2 + 70, top - 145);
      makeButton(this.node, '▶', 90, 70, '#37415a', () => this.switchBeast(1), this.W / 2 - 70, top - 145);
    }
    this.bottomBtn = makeButton(this.node, opts.practice ? '关闭' : '跳过', 220, 72, '#37415a', () => this.onBottom(), 0, -this.H / 2 + 110);
    this.begin(opts.beast, opts.session);
  }

  private begin(beast: BeastDef, session?: RevealSession): void {
    this.beast = beast;
    this.session =
      session ||
      new RevealSession(App.cfg.reveal, beast, { rng: new Rng((Date.now() * 2654435761) >>> 0), isBoss: this.opts.isBoss });
    const now = App.platform.perfNow();
    this.phase = 'intro';
    this.phaseStart = now;
    this.lastPerf = now;
    this.sessionT = 0;
    this.frozenUntil = 0;
    this.lastThrowT = -Infinity;
    this.feedbackAt = -1e9;
    if (this.resultNode) {
      this.resultNode.destroy();
      this.resultNode = null;
    }
    if (this.bottomBtn) this.bottomBtn.node.active = true;

    const cfg = App.cfg.beasts;
    const rar = cfg.rarities[beast.rarity];
    const el = cfg.elements[beast.element];
    let tag = this.opts.practice ? `拍符练习（${this.practiceIndex + 1}/${(this.opts.practiceList || []).length}）` : this.opts.sourceText || '异兽现身！';
    if (this.opts.isBoss) tag += ' · Boss 收服';
    if (this.opts.shiny) tag += ' · ✦闪光✦';
    setLabel(this.tag, tag);
    setLabel(this.title, beast.name, rar.color);
    setLabel(this.sub, `「${beast.quote}」`);
    setLabel(this.beastLabel, `${el.name} · ${rar.name}`);
    setLabel(this.sealsLabel, sealsText(0, this.session.throwsTotal));
    setLabel(this.throwsLabel, `符 ${this.session.throwsLeft} / ${this.session.throwsTotal}`);
    setLabel(this.feedback, '');
    setLabel(this.hint, '');

    const br = this.radius * 0.42;
    const g = this.beastG;
    g.clear();
    const art = `beast_${beast.id}`;
    if (Skin.has(art)) {
      // 有立绘：圆内放一圈淡淡的五行色光晕，立绘放在中间
      g.fillColor = hex(el.color, 70);
      g.circle(0, 0, this.radius * 0.78);
      g.fill();
      setLabel(this.beastLabel, '');
      this.beastArt.active = true;
      const size = this.radius * 1.45;
      setSprite(this.beastArt, art, size, size);
    } else {
      this.beastArt.active = false;
      g.fillColor = hex(el.color, this.opts.shiny ? 255 : 220);
      g.circle(0, 0, br);
      g.fill();
      g.lineWidth = 8;
      g.strokeColor = hex(rar.color);
      g.circle(0, 0, br);
      g.stroke();
      // 金白色的五行（金）底色较浅，名字用深色
      this.beastLabel.color = hex(beast.element === 'jin' ? '#333333' : '#ffffff');
    }

    App.analytics.track('reveal_start', { beast: beast.id, rarity: beast.rarity, practice: this.opts.practice, boss: this.opts.isBoss });
  }

  // ------------------------------------------------------------ 交互

  private onTap(): void {
    if (this.phase !== 'play') return;
    const now = App.platform.perfNow();
    this.syncClock(now);
    const raw = App.platform.lastTouchStartAt();
    const ago = raw !== null && now - raw >= 0 && now - raw <= TOUCH_MAX_AGE_MS ? now - raw : 0;
    const res = this.session.throwAt(Math.max(0, this.sessionT - ago));
    if (!res) return;
    this.session.advance(this.sessionT);
    this.lastThrowT = this.sessionT;

    this.feedbackAt = now;
    this.feedbackColor = JUDGE_COLOR[res.judge];
    setLabel(this.feedback, JUDGE_TEXT[res.judge], this.feedbackColor);
    if (res.judge === 'perfect') {
      this.frozenUntil = now + HIT_STOP_MS;
      this.shakeUntil = now + SHAKE_MS;
      if (App.core.state.settings.vibrate) App.platform.vibrateShort();
    }
    setLabel(this.sealsLabel, sealsText(this.session.seals, this.session.throwsTotal));
    setLabel(this.throwsLabel, `符 ${this.session.throwsLeft} / ${this.session.throwsTotal}`);
    App.analytics.track('reveal_throw', {
      beast: this.beast.id,
      rarity: this.beast.rarity,
      judge: res.judge,
      deviationMs: Math.round(res.deviationMs),
      touchAgoMs: Math.round(ago),
      practice: this.opts.practice,
    });
    if (this.session.done) {
      this.phase = 'ending';
      this.phaseStart = now;
    }
  }

  private onBottom(): void {
    if (this.opts.practice) {
      this.close();
      return;
    }
    if (this.phase === 'intro' || this.phase === 'play' || this.phase === 'ending') this.showResult(true);
  }

  private switchBeast(step: number): void {
    const list = this.opts.practiceList || [];
    if (!list.length) return;
    this.practiceIndex = (this.practiceIndex + step + list.length) % list.length;
    this.begin(list[this.practiceIndex]);
  }

  private close(): void {
    this.node.destroy();
    if (this.opts.onClose) this.opts.onClose();
  }

  /** 把会话时钟推进到 now；顿帧期间时间不走。 */
  private syncClock(now: number): void {
    const elapsed = Math.max(0, now - this.lastPerf);
    this.lastPerf = now;
    if (this.phase === 'play' && now >= this.frozenUntil) this.sessionT += elapsed;
  }

  // ------------------------------------------------------------ 每帧

  update(): void {
    if (!this.session) return;
    const now = App.platform.perfNow();
    if (this.phase === 'intro' && now - this.phaseStart >= INTRO_MS) {
      this.phase = 'play';
      this.lastPerf = now;
    }
    this.syncClock(now);
    if (this.phase === 'play') this.session.advance(this.sessionT);
    if (this.phase === 'ending' && now - this.phaseStart >= END_DELAY_MS) this.showResult(false);
    this.render(now);
  }

  private render(now: number): void {
    const s = this.session;
    const r = this.radius;

    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / SHAKE_MS;
      this.root.setPosition((Math.random() * 2 - 1) * 10 * k, (Math.random() * 2 - 1) * 10 * k);
    } else {
      this.root.setPosition(0, 0);
    }

    const introP = this.phase === 'intro' ? Math.min(1, (now - this.phaseStart) / INTRO_MS) : 1;
    const sc = 0.6 + 0.4 * introP;
    this.beastG.node.setScale(sc, sc, 1);
    this.beastArt.setScale(sc, sc, 1);

    const g = this.ringG;
    const o = this.overlayG;
    g.clear();
    o.clear();
    if (introP < 1 || this.phase === 'result') {
      g.lineWidth = 22;
      g.strokeColor = hex('#2c3446', Math.round(255 * introP));
      g.circle(0, 0, r);
      g.stroke();
      this.marker.active = false;
      setLabel(this.hint, '');
      return;
    }

    const beh = this.beast.reveal || {};
    const zones = s.zones();
    const vis = visualState(beh, {
      t: s.elapsed,
      markerAngle: s.markerAngle,
      direction: s.direction,
      zones,
      telegraph: s.telegraph(),
      radius: r,
      lastThrowT: this.lastThrowT,
      isStruggleThrow: s.isStruggleThrow && this.phase === 'play',
    });

    // 底环
    g.lineWidth = 22;
    g.strokeColor = hex('#2c3446', Math.round(255 * vis.ringPulse));
    g.circle(0, 0, r);
    g.stroke();

    // 鸾鸟五采
    if (vis.rainbow && zones[0]) {
      const colors = ['#e74c3c', '#f39c12', '#f1c40f', '#3498db', '#9b59b6'];
      for (let i = 0; i < vis.rainbow.length; i++) strokePolyline(g, arcPoints(vis.rainbow[i], zones[0].halfGood, r), 22, hex(colors[i % colors.length], 150));
    }

    // 判定区：不错（黄）→ 虎牙（红）→ 完美（绿）
    const za = Math.round(255 * vis.zoneAlpha);
    for (const z of zones) {
      if (!z.active) {
        strokePolyline(g, arcPoints(z.center, z.halfPerfect, r), 12, hex('#55606f', 170));
        continue;
      }
      if (z.halfGood > z.halfPerfect) strokePolyline(g, arcPoints(z.center, z.halfGood, r), 22, hex('#f5c542', za));
      if (vis.teeth) {
        strokePolyline(g, arcPoints(z.center - 2 * z.halfPerfect, z.halfPerfect, r), 22, hex('#e53935', za));
        strokePolyline(g, arcPoints(z.center + 2 * z.halfPerfect, z.halfPerfect, r), 22, hex('#e53935', za));
      }
      strokePolyline(g, arcPoints(z.center, z.halfPerfect, r), 28, hex('#3ddc84', za));
    }

    // 旋龟龟壳
    if (vis.occluder) strokePolyline(g, arcPoints(vis.occluder.center, vis.occluder.half, r), 46, hex('#6d4c41'));

    // 符箓：放在圆环上，竖着朝外
    this.marker.active = !vis.markerHidden && this.phase !== 'ending';
    if (this.marker.active) {
      const p = polar(s.markerAngle, r);
      this.marker.setPosition(p.x, p.y);
      this.marker.angle = -s.markerAngle;
    }

    // 只影响表现的遮挡：水位、变暗、雷光
    if (vis.waterLevel > 0) {
      const bottom = -r - 40;
      const top = -r + vis.waterLevel * 2 * r;
      o.fillColor = hex('#1e88e5', 220);
      o.rect(-r - 40, bottom, 2 * r + 80, top - bottom);
      o.fill();
    }
    if (vis.hidden) {
      o.fillColor = hex('#000000', 220);
      o.circle(0, 0, r + 30);
      o.fill();
    }
    if (vis.lightning) {
      strokePolyline(o, [{ x: -24, y: r + 150 }, { x: 12, y: r + 90 }, { x: -12, y: r + 90 }, { x: 24, y: r + 20 }], 8, hex('#fff59d'));
    }

    setLabel(this.hint, this.phase === 'play' && vis.hint ? vis.hint : '');

    const fp = (now - this.feedbackAt) / FEEDBACK_MS;
    if (fp >= 0 && fp < 1) {
      const fs = 1 + 0.35 * (1 - fp);
      this.feedback.node.setScale(fs, fs, 1);
      this.feedback.color = hex(this.feedbackColor, Math.round(255 * (1 - fp * fp)));
    } else if (this.feedback.string) {
      setLabel(this.feedback, '');
    }
  }

  // ------------------------------------------------------------ 结果

  private showResult(skipped: boolean): void {
    if (this.phase === 'result') return;
    this.phase = 'result';
    const s = this.session;
    const seals = skipped ? App.cfg.reveal.skipSeals : s.seals;
    let body: string;
    if (this.opts.practice) {
      body = s.throws.length
        ? s.throws.map((t, i) => `第 ${i + 1} 拍：${JUDGE_TEXT[t.judge]}（离中心 ${Math.round(t.deviationMs)}ms）`).join('\n')
        : '没有拍';
    } else {
      body = this.opts.onSettle ? this.opts.onSettle(seals, skipped, s.throws) : '';
    }
    App.analytics.track('reveal_result', {
      beast: this.beast.id,
      rarity: this.beast.rarity,
      seals,
      skipped,
      practice: this.opts.practice,
    });

    if (this.bottomBtn) this.bottomBtn.node.active = false;
    setLabel(this.feedback, '');
    setLabel(this.sealsLabel, '');
    setLabel(this.throwsLabel, '');
    setLabel(this.hint, '');
    const panel = uiNode('Result', this.node);
    this.resultNode = panel;
    const w = Math.min(640, this.W - 60);
    const h = 520;
    const bg = panel.addComponent(Graphics);
    bg.fillColor = hex('#1b2233', 245);
    bg.roundRect(-w / 2, -h / 2, w, h, 24);
    bg.fill();
    bg.lineWidth = 4;
    bg.strokeColor = hex(seals >= 3 ? '#ffd54f' : '#3a4560');
    bg.roundRect(-w / 2, -h / 2, w, h, 24);
    bg.stroke();
    const headline = skipped ? '已跳过' : seals >= 3 ? '三印归一！' : `${seals} 印`;
    makeLabel(panel, headline, 52, seals >= 3 ? '#ffd54f' : '#ffffff', 0, h / 2 - 70);
    makeLabel(panel, sealsText(seals, s.throwsTotal), 48, '#ffd54f', 0, h / 2 - 140);
    makeLabel(panel, body, 26, '#e6e9ef', 0, 0);
    if (this.opts.practice) {
      makeButton(panel, '再来一次', 220, 72, '#3ddc84', () => this.begin(this.beast), -125, -h / 2 + 70);
      makeButton(panel, '关闭', 220, 72, '#37415a', () => this.close(), 125, -h / 2 + 70);
    } else {
      makeButton(panel, '收下', 260, 76, '#3ddc84', () => this.close(), 0, -h / 2 + 70);
    }
  }
}
