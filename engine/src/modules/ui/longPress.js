// Long presses, the same in every runtime: the native one (ui.js) and the
// web adapter (engine/web/src/ui/view.ts). Each runtime routes its pointers
// here and dispatches the events; what a press must do to be a long press,
// and what one does, is decided only here.

const delay = 500;
const slop = 10;

/**
 * Whether a press can become a long press: the primary button alone, on a
 * node in the tree. A touch held in a text input is the input's own (its
 * caret, its selection, a phone's Paste), never a long press.
 */
export function canHold(target, button, buttons, pointerType) {
  return (
    button === 0 &&
    buttons === 1 &&
    target.isConnected &&
    !(pointerType === 'touch' && target.type === 'input')
  );
}

/**
 * What a recognized long press does: `longpress`, then, for a touch only,
 * its default, `contextmenu`, unless `longpress` was canceled. `dispatch`
 * sends one of them to the pressed node and returns whether it was not
 * canceled; `available` says whether the node can still take input.
 * Returns whether the press was consumed (either one canceled), so its
 * release does not click. For a touch that is also whether the menu
 * request was canceled.
 */
export function longPressed(pointerType, dispatch, available) {
  if (!dispatch('longpress')) return true;
  return pointerType === 'touch' && available() && !dispatch('contextmenu');
}

// A held primary pointer: its node, where it went down, and its timer.
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

  /** Whether a press of this pointer may still become a long press. */
  pending(id) {
    return this.#pending.has(id);
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
