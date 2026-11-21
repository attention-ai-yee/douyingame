/** 极简事件总线：core 只发事件，view 订阅后刷新界面。 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private map: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const list = this.map[type] || (this.map[type] = []);
    list.push(fn);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const list = this.map[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.map[type];
    if (!list) return;
    for (const fn of list.slice()) fn(payload);
  }
}
