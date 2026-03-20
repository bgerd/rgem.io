// src/types/grid.ts

// Status of the RGEM "connection"
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// Logical RGB color for a single cell
export type RgbColor = {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
};

// A grid is an array of 16 cells (index 0–15 == cellId)
export type GridState = RgbColor[];
