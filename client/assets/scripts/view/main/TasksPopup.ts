import { Graphics, Node } from 'cc';
import { App } from '../../app/App';
import { DailyTaskStatus, formatNumber } from '../../core';
import { makeSprite } from '../ui/Skin';
import { hex, makeLabel, uiNode } from '../ui/UiKit';
import { alignedLabel, popup, skinButton } from '../ui/Widgets';

const OL = '#4a2f27';

/** 每日任务弹窗（游戏设计文档 10.3）：每项完成领寻兽符，全部完成再领金币经验。每天 0 点重置。 */
export class TasksPopup {
  static open(parent: Node, toast: (t: string) => void, onClose: () => void): TasksPopup {
    return new TasksPopup(parent, toast, onClose);
  }

  private pop: { root: Node; body: Node; close(): void };
  private list: Node;

  private constructor(parent: Node, private toast: (t: string) => void, onClose: () => void) {
    this.pop = popup(parent, '每日任务', 680, 980, onClose);
    this.list = uiNode('List', this.pop.body);
    this.build();
  }

  private build(): void {
    this.list.destroy();
    this.list = uiNode('List', this.pop.body);
    const core = App.core;
    const tasks = core.dailyTasks();
    makeLabel(this.list, '每天 0 点刷新 · 每完成一项领寻兽符', 22, '#8a6d55', 0, 400);
    tasks.forEach((t, i) => this.row(t, 300 - i * 130));
    const all = tasks.every((t) => t.done);
    const m = App.cfg.progression.daily.allDoneMinutes;
    const box = uiNode('All', this.list, 0, -370);
    const g = box.addComponent(Graphics);
    g.fillColor = hex(all ? '#fff1c2' : '#f3ede4');
    g.roundRect(-300, -60, 600, 120, 20);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = hex(all ? '#f5a623' : '#c9b8a2');
    g.roundRect(-300, -60, 600, 120, 20);
    g.stroke();
    alignedLabel(box, '全部完成奖励', 26, OL, -270, 22, 'left');
    alignedLabel(box, `金币 +${formatNumber(m * core.goldPerMin())} · 经验 +${formatNumber(m * core.expPerMin())}`, 22, '#6b5444', -270, -20, 'left');
    if (App.core.state.daily.allTasksClaimed) {
      makeLabel(box, '已领取', 26, '#3fcf7f', 200, 0);
    } else {
      const b = skinButton(box, 'btn_red', '领取', 160, 76, () => this.onClaimAll(), 200, 0);
      b.setEnabled(core.canClaimAllTasks());
    }
  }

  private row(t: DailyTaskStatus, y: number): void {
    const r = uiNode('Row', this.list, 0, y);
    const g = r.addComponent(Graphics);
    g.fillColor = hex('#ffffff');
    g.roundRect(-300, -54, 600, 108, 18);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = hex('#e3d6c4');
    g.roundRect(-300, -54, 600, 108, 18);
    g.stroke();
    alignedLabel(r, t.target > 1 ? `${t.name} ${t.target} 次` : t.name, 26, OL, -270, 20, 'left');
    // 进度条
    const w = 260;
    const bar = uiNode('Bar', r, -270 + w / 2, -22).addComponent(Graphics);
    bar.fillColor = hex('#efe7db');
    bar.roundRect(-w / 2, -9, w, 18, 9);
    bar.fill();
    if (t.progress > 0) {
      bar.fillColor = hex(t.done ? '#3fcf7f' : '#ffc43d');
      bar.roundRect(-w / 2, -9, Math.max(18, (w * t.progress) / t.target), 18, 9);
      bar.fill();
    }
    alignedLabel(r, `${t.progress}/${t.target}`, 20, '#8a6d55', -270 + w + 14, -22, 'left');
    makeSprite(r, 'icon_ticket', 44, 44, 110, 0, { optional: true });
    makeLabel(r, `×${t.tickets}`, 22, OL, 150, 0);
    if (t.claimed) makeLabel(r, '已领取', 24, '#3fcf7f', 236, 0);
    else {
      const b = skinButton(r, t.done ? 'btn_red' : 'btn_ink', t.done ? '领取' : '未完成', 130, 66, () => this.onClaim(t), 236, 0);
      b.setEnabled(t.done);
    }
  }

  private onClaim(t: DailyTaskStatus): void {
    const n = App.core.claimTask(t.id);
    if (!n) return;
    App.analytics.track('task_claim', { task: t.id });
    App.save();
    this.toast(`寻兽符 +${n}`);
    this.build();
  }

  private onClaimAll(): void {
    const r = App.core.claimAllTasks();
    if (!r) return;
    App.analytics.track('task_claim', { task: 'all' });
    App.save();
    this.toast(`全部完成！金币 +${formatNumber(r.gold)} · 经验 +${formatNumber(r.exp)}`);
    this.build();
  }
}
