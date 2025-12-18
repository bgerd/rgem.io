// src/components/RGemGridPage.tsx
import React from "react";
import type { GridState, RgbColor } from "../types/grid";

export type RGemGridPageProps = {
  cells: GridState;
  onCellClick: (cellId: number) => void;
  isLabelVisible: boolean;
};

// Convert a logical RGB color to a CSS background color.
//  - Logical (0,0,0) is displayed as light gray in the UI to represent "off"
//  - All other RGB values are lighted up by 30% in Oklch color space for better visibility
 
function logicalColorToCss({ r, g, b }: RgbColor): string {
  const isOff = r === 0 && g === 0 && b === 0;
  if (isOff) {
    return "#d3d3d3"; // light gray, instead of pure black
  }
  // returns CSS rgb() string lighted up by 30% in Oklch color space
  return `oklch(from rgb(${r}, ${g}, ${b}) calc(l + 0.30) c h)`;
}

export const RGemGridPage: React.FC<RGemGridPageProps> = ({
  cells,
  onCellClick,
  isLabelVisible
}) => {
  return (
    <div className="rgem-grid-page">
      { /* Note: Review .rgem-grid style for 4x4 layout */ }
      <div className="rgem-grid">
        {/* Note: Remember cellId is the index of the cell in the grid
            provided by the map function */}
        {cells.map((color, cellId) => (
          <button
            key={cellId}
            type="button"
            className="rgem-grid-cell"
            style={{ backgroundColor: logicalColorToCss(color) }}
            onClick={() => onCellClick(cellId)}
            // Accessibility attributes:
            // - role/button implied by <button>
            // - keyboard interaction handled automatically
          >
            {/* Optional: display the cellId for debugging / visibility */}
            <span 
              className="rgem-grid-cell-label"
              style={{ visibility: isLabelVisible ? "visible" : "hidden" }}
            >{cellId}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
