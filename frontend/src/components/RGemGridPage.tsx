// src/components/RGemGridPage.tsx
import React from "react";
import type { GridState } from "../types/grid";
import { logicalColorToCss } from "../lib/color";

export type RGemGridPageProps = {
  cells: GridState;
  onCellClick: (cellId: number) => void;
  onCellDoubleClick: (cellId: number) => void;
  isLabelVisible: boolean;
};

export const RGemGridPage: React.FC<RGemGridPageProps> = ({
  cells,
  onCellClick,
  onCellDoubleClick,
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
            onDoubleClick={() => onCellDoubleClick(cellId)}
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
