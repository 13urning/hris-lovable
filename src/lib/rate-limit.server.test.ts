import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceRateLimit,
  RATE_LIMIT_MESSAGE,
  __resetRateLimiterForTests,
  type RateLimitRule,
} from "./rate-limit.server";

const RULE: RateLimitRule = { limit: 3, windowMs: 1_000 };

describe("enforceRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    __resetRateLimiterForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows exactly `limit` hits within the window, then throws", () => {
    expect(() => enforceRateLimit("k", RULE)).not.toThrow(); // 1
    expect(() => enforceRateLimit("k", RULE)).not.toThrow(); // 2
    expect(() => enforceRateLimit("k", RULE)).not.toThrow(); // 3
    expect(() => enforceRateLimit("k", RULE)).toThrow(RATE_LIMIT_MESSAGE); // 4 -> blocked
  });

  it("keeps throttling while abuse continues past the limit", () => {
    for (let i = 0; i < RULE.limit; i++) enforceRateLimit("k", RULE);
    // A recorded-but-rejected hit means the window stays full: the very next call
    // (still inside the window) is also rejected rather than let through.
    expect(() => enforceRateLimit("k", RULE)).toThrow(RATE_LIMIT_MESSAGE);
    vi.advanceTimersByTime(500); // still inside the 1s window
    expect(() => enforceRateLimit("k", RULE)).toThrow(RATE_LIMIT_MESSAGE);
  });

  it("recovers once the sliding window has fully passed", () => {
    for (let i = 0; i < RULE.limit; i++) enforceRateLimit("k", RULE);
    expect(() => enforceRateLimit("k", RULE)).toThrow(); // blocked at t=0
    vi.advanceTimersByTime(RULE.windowMs + 1); // all earlier hits age out
    expect(() => enforceRateLimit("k", RULE)).not.toThrow();
  });

  it("slides rather than resetting on a fixed interval", () => {
    // Two hits at t=0, one at t=600. At t=1001 the two t=0 hits have expired but the
    // t=600 hit is still live, so there is room for exactly two more before blocking.
    enforceRateLimit("k", RULE);
    enforceRateLimit("k", RULE);
    vi.advanceTimersByTime(600);
    enforceRateLimit("k", RULE);
    vi.advanceTimersByTime(401); // t=1001: the two t=0 hits are now > windowMs old
    expect(() => enforceRateLimit("k", RULE)).not.toThrow(); // t=600 hit + this = 2
    expect(() => enforceRateLimit("k", RULE)).not.toThrow(); // = 3
    expect(() => enforceRateLimit("k", RULE)).toThrow(RATE_LIMIT_MESSAGE); // = 4 blocked
  });

  it("tracks each bucket key independently", () => {
    for (let i = 0; i < RULE.limit; i++) enforceRateLimit("user-a", RULE);
    expect(() => enforceRateLimit("user-a", RULE)).toThrow();
    // A different caller is unaffected by user-a exhausting its budget.
    expect(() => enforceRateLimit("user-b", RULE)).not.toThrow();
  });
});
