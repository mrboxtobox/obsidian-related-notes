/**
 * @file Tests for the cooperative scheduling primitives.
 *
 * These guard the property that replaced sleep-based CPU throttling: the plugin
 * must hand control back to the event loop without idling. A regression here
 * (e.g. reintroducing `setTimeout(resolve, 16)`) makes these fail on wall clock.
 */

import { describe, it, expect } from 'vitest';
import { TimeSlicer, yieldToMain, DEFAULT_SLICE_BUDGET_MS } from '../src/scheduler';

const busyWaitMs = (ms: number) => {
  const until = performance.now() + ms;
  // eslint-disable-next-line no-empty
  while (performance.now() < until) {}
};

describe('yieldToMain', () => {
  it('resolves', async () => {
    await expect(yieldToMain()).resolves.toBeUndefined();
  });

  it('does not sleep: 200 yields cost far less than 200 timer ticks', async () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) await yieldToMain();
    const elapsed = performance.now() - start;

    // The old throttle slept 16ms per yield, i.e. >3400ms for this loop. A real
    // yield is ~0.02ms, so the bound is deliberately loose: it only has to sit
    // below "is this sleeping", not pin the fast path, or it flakes under load.
    expect(elapsed).toBeLessThan(500);
  });

  it('defers past the microtask queue, so the event loop can turn', async () => {
    const order: string[] = [];

    const yielded = yieldToMain().then(() => order.push('yield'));
    // Microtasks queued after the yield still run first: the yield is a task,
    // not a promise continuation. A microtask-only "yield" would starve the
    // event loop and never let the UI paint.
    Promise.resolve().then(() => order.push('microtask'));

    await yielded;

    expect(order).toEqual(['microtask', 'yield']);
  });
});

describe('TimeSlicer', () => {
  it('does not yield while inside the budget', async () => {
    const slicer = new TimeSlicer(50);
    for (let i = 0; i < 100; i++) await slicer.tick();
    expect(slicer.yieldCount).toBe(0);
  });

  it('yields once the budget is exceeded, then starts a fresh slice', async () => {
    const slicer = new TimeSlicer(5);
    busyWaitMs(8);
    await slicer.tick();
    expect(slicer.yieldCount).toBe(1);

    // Budget was reset by the yield, so an immediate tick must not yield again.
    await slicer.tick();
    expect(slicer.yieldCount).toBe(1);
  });

  it('yields repeatedly across a long run, scaling with elapsed work', async () => {
    const budget = 10;
    const slicer = new TimeSlicer(budget);
    const workMs = 2;
    const iterations = 40; // ~80ms of work -> ~8 budget windows

    for (let i = 0; i < iterations; i++) {
      busyWaitMs(workMs);
      await slicer.tick();
    }

    // The guarantee is that yields track elapsed time rather than a fixed
    // operation count. Bounds are loose so a slow CI box cannot flake it.
    const windows = (iterations * workMs) / budget;
    expect(slicer.yieldCount).toBeGreaterThanOrEqual(Math.floor(windows / 3));
    expect(slicer.yieldCount).toBeLessThanOrEqual(iterations);
  });

  it('a yielding tick hands off without sleeping', async () => {
    // Budget 0 forces every tick down the yielding path, which is the exact
    // line a regression would replace with `setTimeout(resolve, 16)`.
    const slicer = new TimeSlicer(0);
    const start = performance.now();
    for (let i = 0; i < 200; i++) await slicer.tick();
    const elapsed = performance.now() - start;

    expect(slicer.yieldCount).toBe(200);
    // 200 sleeping ticks would cost >3200ms; 200 real yields cost single-digit ms.
    expect(elapsed).toBeLessThan(500);
  });

  it('defaults to a sub-frame budget', () => {
    expect(DEFAULT_SLICE_BUDGET_MS).toBeLessThanOrEqual(16);
    expect(DEFAULT_SLICE_BUDGET_MS).toBeGreaterThan(0);
  });
});
