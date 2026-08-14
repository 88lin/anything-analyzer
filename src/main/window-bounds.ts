export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clamp renderer-reported native view bounds to the BrowserWindow content area.
 * Native WebContentsView is always above the renderer on Windows, so stale or
 * out-of-range coordinates can otherwise intercept toolbar mouse events.
 */
export function clampBoundsToContent(
  bounds: Bounds,
  content: Pick<Bounds, "width" | "height">,
): Bounds {
  const x = Math.max(0, Math.min(Math.round(bounds.x), content.width));
  const y = Math.max(0, Math.min(Math.round(bounds.y), content.height));
  const width = Math.max(0, Math.min(Math.round(bounds.width), content.width - x));
  const height = Math.max(0, Math.min(Math.round(bounds.height), content.height - y));
  return { x, y, width, height };
}
