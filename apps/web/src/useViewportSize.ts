import { useCallback, useEffect, useState } from "react";

/**
 * The canvas wrapper's size in CSS pixels, kept current on resize.
 *
 * Moved out of `BoardCanvas` unchanged: the canvas only needs the number.
 */
export function useViewportSize(wrapRef: React.RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = useState({ width: 1, height: 1 });

  // A zero-sized viewport means the wrapper has not been laid out yet (a hidden tab,
  // a first paint before fonts): measure again once it has a size.
  useEffect(() => {
    if (viewport.width > 1 && viewport.height > 1) return;
    const timer = window.setTimeout(() => measure(), 60);
    return () => window.clearTimeout(timer);
  }, [viewport.height, viewport.width]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    setViewport((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return viewport;
}
