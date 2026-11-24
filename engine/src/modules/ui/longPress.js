const delay = 500;
const slop = 10;

// Input adapters own gesture targeting and event dispatch. This recognizer
// only tracks a held primary pointer, its original point and its lifetime.
export class LongPresses {
  #pending = new Map();
  #delays = new WeakMap();

  setDelay(node, value) {
    this.#delays.set(node, value);
    return () => {
      if (this.#delays.get(node) === value) this.#delays.delete(node);
      this.cancelWithin(node);
    };
  }

  start(id, target, x, y, recognized) {
    this.cancel(id);
    let duration = delay;
    for (let node = target; node !== null; node = node.parent) {
      if (this.#delays.has(node)) {
        duration = this.#delays.get(node);
        break;
      }
    }
    const timer = setTimeout(() => this.#recognize(id), duration);
    this.#pending.set(id, { timer, target, x, y, recognized, duration });
  }

  // A browser may detect the same touch hold before our timer fires. Use
  // that signal for the default duration, but honor a control's own delay.
  nativeHold(id) {
    if (this.#pending.get(id)?.duration === delay) this.#recognize(id);
  }

  #recognize(id) {
    const press = this.#pending.get(id);
    if (press === undefined) return;
    this.cancel(id);
    if (press.target.isConnected && !press.target.inputDisabled)
      press.recognized();
  }

  move(id, x, y, buttons) {
    const press = this.#pending.get(id);
    if (press && (buttons !== 1 || Math.hypot(x - press.x, y - press.y) > slop))
      this.cancel(id);
  }

  cancel(id) {
    const press = this.#pending.get(id);
    if (press === undefined) return;
    clearTimeout(press.timer);
    this.#pending.delete(id);
  }

  cancelWithin(ancestor) {
    for (const [id, press] of this.#pending)
      for (let node = press.target; node !== null; node = node.parent)
        if (node === ancestor) {
          this.cancel(id);
          break;
        }
  }

  clear() {
    for (const id of this.#pending.keys()) this.cancel(id);
  }
}
