// src/lib/color.ts
//
// Pure utility functions for converting logical RGB colors to CSS strings.
// Extracted from RGemGridPage.tsx to enable unit testing and reuse.

import type { RgbColor } from "../types/grid";

// Convert a logical RGB color to a CSS background color.
//  - Logical (0,0,0) is displayed as light gray in the UI to represent "off"
//  - All other RGB values are lighted up by 30% in Oklch color space for better visibility
export function logicalColorToCss({ r, g, b }: RgbColor): string {
  const isOff = r === 0 && g === 0 && b === 0;
  if (isOff) {
    return "#d3d3d3"; // light gray, instead of pure black
  }
  // returns CSS rgb() string lighted up by 30% in Oklch color space
  return `oklch(from rgb(${r}, ${g}, ${b}) calc(l + 0.30) c h)`;
}
