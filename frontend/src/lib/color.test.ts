import { describe, it, expect } from "vitest";
import { logicalColorToCss } from "./color";

describe("logicalColorToCss", () => {
  it("returns light gray (#d3d3d3) for off state (0,0,0)", () => {
    expect(logicalColorToCss({ r: 0, g: 0, b: 0 })).toBe("#d3d3d3");
  });

  it("returns oklch CSS string for pure red", () => {
    expect(logicalColorToCss({ r: 255, g: 0, b: 0 }))
      .toBe("oklch(from rgb(255, 0, 0) calc(l + 0.30) c h)");
  });

  it("returns oklch CSS string for pure green", () => {
    expect(logicalColorToCss({ r: 0, g: 255, b: 0 }))
      .toBe("oklch(from rgb(0, 255, 0) calc(l + 0.30) c h)");
  });

  it("returns oklch CSS string for pure blue", () => {
    expect(logicalColorToCss({ r: 0, g: 0, b: 255 }))
      .toBe("oklch(from rgb(0, 0, 255) calc(l + 0.30) c h)");
  });

  it("returns oklch CSS string for white (255,255,255)", () => {
    expect(logicalColorToCss({ r: 255, g: 255, b: 255 }))
      .toBe("oklch(from rgb(255, 255, 255) calc(l + 0.30) c h)");
  });

  it("returns oklch CSS string for arbitrary color", () => {
    expect(logicalColorToCss({ r: 128, g: 64, b: 32 }))
      .toBe("oklch(from rgb(128, 64, 32) calc(l + 0.30) c h)");
  });

  it("treats (0,0,1) as non-off — only exact zero is off", () => {
    expect(logicalColorToCss({ r: 0, g: 0, b: 1 }))
      .toBe("oklch(from rgb(0, 0, 1) calc(l + 0.30) c h)");
  });

  it("treats (1,0,0) as non-off", () => {
    expect(logicalColorToCss({ r: 1, g: 0, b: 0 }))
      .toBe("oklch(from rgb(1, 0, 0) calc(l + 0.30) c h)");
  });

  it("treats (0,1,0) as non-off", () => {
    expect(logicalColorToCss({ r: 0, g: 1, b: 0 }))
      .toBe("oklch(from rgb(0, 1, 0) calc(l + 0.30) c h)");
  });
});
