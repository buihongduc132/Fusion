import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePollingWhenVisible } from "../usePollingWhenVisible";

describe("usePollingWhenVisible", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires callback at the specified interval while visible", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    renderHook(() => usePollingWhenVisible(callback, intervalMs));

    // Initial fire on mount
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(intervalMs);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(intervalMs);
    expect(callback).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(intervalMs);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it("pauses interval when page becomes hidden", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    renderHook(() => usePollingWhenVisible(callback, intervalMs));
    expect(callback).toHaveBeenCalledTimes(1);

    // Hide the page
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance time — no additional calls expected while hidden
    vi.advanceTimersByTime(intervalMs * 3);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("resumes interval and fires catch-up callback when page becomes visible", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    renderHook(() => usePollingWhenVisible(callback, intervalMs));
    expect(callback).toHaveBeenCalledTimes(1);

    // Hide the page
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(intervalMs * 3);
    expect(callback).toHaveBeenCalledTimes(1);

    // Make the page visible again
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Catch-up callback fires immediately on resume
    expect(callback).toHaveBeenCalledTimes(2);

    // Periodic calls resume
    vi.advanceTimersByTime(intervalMs);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("cleans up interval on unmount", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    const { unmount } = renderHook(() =>
      usePollingWhenVisible(callback, intervalMs),
    );
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();

    vi.advanceTimersByTime(intervalMs * 3);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not start interval when enabled is false", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    renderHook(() =>
      usePollingWhenVisible(callback, intervalMs, { enabled: false }),
    );

    vi.advanceTimersByTime(intervalMs * 3);
    expect(callback).not.toHaveBeenCalled();
  });

  it("starts interval when enabled transitions from false to true", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePollingWhenVisible(callback, intervalMs, { enabled }),
      { initialProps: { enabled: false } },
    );

    vi.advanceTimersByTime(intervalMs);
    expect(callback).not.toHaveBeenCalled();

    // Enable polling
    rerender({ enabled: true });

    // Fires immediately on enable
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(intervalMs);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("stops interval when enabled transitions from true to false", () => {
    const callback = vi.fn();
    const intervalMs = 5_000;

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePollingWhenVisible(callback, intervalMs, { enabled }),
      { initialProps: { enabled: true } },
    );

    expect(callback).toHaveBeenCalledTimes(1);

    // Disable polling
    rerender({ enabled: false });

    vi.advanceTimersByTime(intervalMs * 3);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("uses latest callback ref after rerender", () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();
    const intervalMs = 5_000;

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        usePollingWhenVisible(cb, intervalMs),
      { initialProps: { cb: callbackA } },
    );

    expect(callbackA).toHaveBeenCalledTimes(1);

    // Switch to callback B
    rerender({ cb: callbackB });

    vi.advanceTimersByTime(intervalMs);
    // callbackB should be called (not callbackA)
    expect(callbackB).toHaveBeenCalledTimes(1);
    // callbackA was only called on the initial mount
    expect(callbackA).toHaveBeenCalledTimes(1);
  });
});
