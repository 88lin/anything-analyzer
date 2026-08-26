import { describe, expect, it } from "vitest";
import { clampBoundsToContent } from "../../src/main/window-bounds";

describe("native browser view bounds", () => {
  const content = { width: 1400, height: 900 };

  it("preserves valid renderer placeholder bounds", () => {
    expect(clampBoundsToContent({ x: 221, y: 122, width: 1179, height: 752 }, content))
      .toEqual({ x: 221, y: 122, width: 1179, height: 752 });
  });

  it("clamps stale oversized bounds so they cannot cover the renderer toolbar", () => {
    expect(clampBoundsToContent({ x: -200, y: -100, width: 5000, height: 5000 }, content))
      .toEqual({ x: 0, y: 0, width: 1400, height: 900 });
  });

  it("clamps a view positioned beyond the content edge to an empty safe rectangle", () => {
    expect(clampBoundsToContent({ x: 1500, y: 950, width: 200, height: 200 }, content))
      .toEqual({ x: 1400, y: 900, width: 0, height: 0 });
  });
});
