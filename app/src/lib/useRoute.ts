// src/lib/useRoute.ts
import { useState, useEffect } from "react";

/**
 * Returns the current window.location.pathname and re-renders when it changes.
 * Subscribes to the `popstate` event for browser back/forward navigation.
 * NOTE: pushState does NOT fire popstate — callers must dispatch a PopStateEvent
 * manually after calling history.pushState to trigger a re-render.
 */
export function useRoute(): string {
  const [pathname, setPathname] = useState<string>(window.location.pathname);

  useEffect(() => {
    const onPopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return pathname;
}
