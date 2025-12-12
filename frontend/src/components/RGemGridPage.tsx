// src/components/RGemGridPage.tsx
import React from "react";
import type { GridState, RgbColor } from "../types/grid";

export type RGemGridPageProps = {
  cells: GridState;
  onCellClick: (cellId: number, color: RgbColor) => void;
};

/**
 * Convert a logical RGB color to a CSS background color.
 *
 * NOTE:
 * - Logical (0,0,0) is displayed as light gray in the UI to represent "off"
 * - All other RGB values are mapped directly to CSS rgb(r,g,b)
 */
function logicalColorToCss({ r, g, b }: RgbColor): string {
  const isOff = r === 0 && g === 0 && b === 0;
  if (isOff) {
    return "#d3d3d3"; // light gray, instead of pure black
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export const RGemGridPage: React.FC<RGemGridPageProps> = ({
  cells,
  onCellClick,
}) => {
  return (
    <div className="rgem-grid-page">
      <div className="rgem-grid">
        {/* Note: Remember cellId is the index of the cell in the grid
            provided by the map function */}
        {cells.map((color, cellId) => (
          <button
            key={cellId}
            type="button"
            className="rgem-grid-cell"
            style={{ backgroundColor: logicalColorToCss(color) }}
            onClick={() => onCellClick(cellId, color)}
            // Accessibility attributes:
            // - role/button implied by <button>
            // - keyboard interaction handled automatically
          >
            {/* Optional: display the cellId for debugging / visibility */}
            <span className="rgem-grid-cell-label">{cellId}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
