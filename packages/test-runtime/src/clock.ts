const framesPerSecond = 60;

/** A bounded, monotonic clock; callbacks scheduled for the same time run in order. */
export class VirtualClock {
  now = 0;
  private nextId = 1;
  private jobs = new Map<
    number,
    { at: number; call: () => void; first: boolean }
  >();
  /** How long until the next frame, as frames are at multiples of 1/60 s. */
  untilNextFrame(): number {
    const next =
      ((Math.floor((this.now * framesPerSecond) / 1000 + 1e-9) + 1) * 1000) /
      framesPerSecond;
    return next - this.now;
  }
  /** `first`: ahead of whatever else is due at that time, whenever it was set. */
  setTimeout(call: () => void, delay = 0, first = false): number {
    if (!Number.isFinite(delay) || delay < 0)
      throw new RangeError('delay must be finite and nonnegative');
    const id = this.nextId++;
    this.jobs.set(id, { at: this.now + delay, call, first });
    return id;
  }
  clearTimeout(id: number) {
    this.jobs.delete(id);
  }
  advance(milliseconds: number, sample: () => void = () => {}) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new RangeError('time must be finite and nonnegative');
    const end = this.now + milliseconds;
    let count = 0;
    for (;;) {
      const next = [...this.jobs]
        .filter(([, job]) => job.at <= end)
        .sort(
          (a, b) =>
            a[1].at - b[1].at ||
            Number(b[1].first) - Number(a[1].first) ||
            a[0] - b[0],
        )[0];
      if (!next) break;
      if (++count > 100000)
        throw new Error('virtual clock exceeded its callback limit');
      this.now = next[1].at;
      sample();
      this.jobs.delete(next[0]);
      next[1].call();
    }
    this.now = end;
    sample();
  }
  get pending() {
    return this.jobs.size;
  }
  clear() {
    this.jobs.clear();
  }
}
