/**
 * @file Cooperative scheduling primitives.
 *
 * The plugin needs to stay responsive while doing long CPU-bound passes
 * (indexing the vault, comparing bloom filters). The original approach was to
 * sleep — `await new Promise(r => setTimeout(r, 16))` every N operations — but
 * sleeping does not make the UI more responsive than simply yielding, it just
 * idles the CPU. On a 5,000-file vault that cost tens of seconds of pure idle
 * time, dwarfing the actual work.
 *
 * What responsiveness actually requires is never occupying the main thread for
 * longer than a frame. That is what `TimeSlicer` does: run work until the
 * budget is spent, hand control back to the event loop, then continue.
 */

/**
 * Default main-thread budget between yields, in milliseconds. Half a 60fps
 * frame, so a slice plus the surrounding frame work still lands inside 16.7ms.
 */
export const DEFAULT_SLICE_BUDGET_MS = 8;

/** Pending resolvers, drained one per port message. */
const pending: Array<() => void> = [];
let channel: MessageChannel | null = null;

/** True in a renderer (Obsidian, browser); false under bare Node (tests, CI). */
const hasDom = typeof document !== "undefined";

function port(): MessagePort {
  if (!channel) {
    channel = new MessageChannel();
    // Assigning onmessage implicitly starts the port.
    channel.port1.onmessage = () => pending.shift()?.();
  }
  return channel.port2;
}

/**
 * Hand control back to the event loop, allowing input handling and paint, then
 * resume as soon as possible.
 *
 * Uses `scheduler.yield()` where available (Chromium 129+, which recent Obsidian
 * builds ship), then a MessageChannel round-trip in any renderer. MessageChannel
 * is preferred over `setTimeout(0)` there because nested timers are clamped to
 * 4ms by browsers and Electron, whereas port messages are not — measured at
 * ~0.02ms per yield versus ~1.2ms for `setTimeout(0)` and ~17ms for
 * `setTimeout(16)`.
 *
 * Under bare Node (tests, CI) `setImmediate` is used instead. An open
 * MessagePort is an active libuv handle, so a Node process that yielded via the
 * channel would never exit; ref/unref'ing it around each yield fixes that but
 * costs more than the yield itself. `setImmediate` is the correct Node
 * macrotask: it does not hold the loop open and needs no bookkeeping.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === "function") {
    return scheduler.yield();
  }
  if (!hasDom && typeof setImmediate === "function") {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }
  return new Promise<void>((resolve) => {
    pending.push(resolve);
    port().postMessage(null);
  });
}

/**
 * Yields only once the main thread has been held for longer than the budget,
 * so short passes never yield at all and long ones stay frame-friendly.
 *
 * Replaces fixed "yield every N operations" throttling, which cannot know how
 * expensive an operation is: 10 comparisons take microseconds, 10 file reads
 * take milliseconds. Budgeting by elapsed time adapts to both, and to the
 * speed of the machine.
 *
 * ```ts
 * const slicer = new TimeSlicer();
 * for (const item of items) {
 *   await slicer.tick();
 *   process(item);
 * }
 * ```
 */
export class TimeSlicer {
  private deadline: number;
  private yields = 0;

  constructor(private readonly budgetMs: number = DEFAULT_SLICE_BUDGET_MS) {
    this.deadline = performance.now() + budgetMs;
  }

  /** Yield if the current slice is exhausted; otherwise return immediately. */
  async tick(): Promise<void> {
    if (performance.now() < this.deadline) return;
    await yieldToMain();
    this.yields++;
    this.deadline = performance.now() + this.budgetMs;
  }

  /** Start a fresh slice, e.g. after an await that already gave up the thread. */
  reset(): void {
    this.deadline = performance.now() + this.budgetMs;
  }

  /** Number of yields performed; used by the performance regression tests. */
  get yieldCount(): number {
    return this.yields;
  }
}
