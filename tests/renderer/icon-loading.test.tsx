import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconLoading } from "../../src/renderer/ui/Icons";

describe("IconLoading", () => {
  it("keeps the rotation inside the fixed SVG viewport", () => {
    const markup = renderToStaticMarkup(<IconLoading size={14} />);

    expect(markup).toContain('overflow="hidden"');
    expect(markup).toMatch(/<g><path[^>]*><\/path><animateTransform/);
  });
});
