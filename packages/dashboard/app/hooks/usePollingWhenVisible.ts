import { useEffect, useRef } from "react";

/**
 * Visibility-aware polling hook.
 *
 * Starts a recurring `callback` at the given `intervalMs` while the page is
 * visible. When the tab becomes hidden the interval is paused; when it
 * becomes visible again the callback fires immediately (catch-up) and the
 * interval restarts.
 *
 * Pass `{ enabled: false }` to suppress the interval entirely (useful for
 * gating on feature flags, auth state, etc.).
 *
 * The callback is stored in a ref so the interval never captures a stale
 * closure — callers can use local state/props freely without worrying about
 * the interval holding on to old values.
 */
export function usePollingWhenVisible(
  callback: () => void,
  intervalMs: number,
  options?: { enabled?: boolean },
): void {
  const enabled = options?.enabled !== false;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    function clearPollingInterval() {
      if (intervalIdRef.current !== null) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    }

    function startPollingInterval() {
      clearPollingInterval();
      callbackRef.current();
      intervalIdRef.current = setInterval(() => {
        callbackRef.current();
      }, intervalMs);
    }

    // Start immediately if enabled and visible
    if (enabled && document.visibilityState === "visible") {
      startPollingInterval();
      pausedRef.current = false;
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearPollingInterval();
        pausedRef.current = true;
      } else if (document.visibilityState === "visible") {
        if (enabled) {
          startPollingInterval();
        }
        pausedRef.current = false;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearPollingInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
