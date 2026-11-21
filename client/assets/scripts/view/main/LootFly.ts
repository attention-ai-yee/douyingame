import { _decorator, Component } from 'cc';

/** 掉落物沿弧线飞向宝箱，到达后触发回调。 */
@_decorator.ccclass('LootFly')
export class LootFly extends Component {
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  dur = 0.7;
  onArrive: (() => void) | null = null;
  private t = 0;

  update(dt: number): void {
    this.t += dt;
    const p = Math.min(1, this.t / this.dur);
    const e = p * p;
    const x = this.x0 + (this.x1 - this.x0) * e;
    const y = this.y0 + (this.y1 - this.y0) * e + Math.sin(p * Math.PI) * 120;
    this.node.setPosition(x, y);
    const k = 1 - 0.4 * p;
    this.node.setScale(k, k, 1);
    if (p >= 1) {
      if (this.onArrive) this.onArrive();
      this.node.destroy();
    }
  }
}
