// src/lib/gem-state.ts
//
// Pure utility functions for decoding gem state wire protocol messages.
// Extracted from App.tsx to enable unit testing and reuse.

import type { GridState } from "../types/grid";

/**
 * Decode a base64-encoded 8-byte big-endian timestamp into a number.
 *
 * Wire format: base64 string -> 8 raw bytes -> BigUint64 (big-endian) -> Number
 */
export function decodeTimestampString(timestampString: string): number {
  // Convert base64-encoded timestampString into raw bytes
  const timestampRaw = atob(timestampString);

  // Convert a timestampRaw into a Uint8Array.
  const timestampArray = Uint8Array.from(timestampRaw, c => c.charCodeAt(0));

  //  Read as BigInt (Big-Endian)
  const view = new DataView(timestampArray.buffer);
  const timestamp = Number(view.getBigUint64(0));

  return timestamp;
}

// Helper to convert a base64-encoded gemState string into a GridState
export function decodeGemStateString(gemStateString: string): GridState {
  const cells: GridState = [];

  // Convert base64-encoded gemStateString into raw bytes
  const gemStateRaw = atob(gemStateString);

  // Convert a 48-byte (16 x 24-bit/3-byte RGB) gemStateRaw into a gemStateBuf.
  const gemStateBuf = Uint8Array.from(gemStateRaw, c => c.charCodeAt(0));

  // Convert gemStateBuf into GridState
  for (let idx = 0; idx < 16; idx++) {
    cells.push({
      r: gemStateBuf[idx * 3],
      g: gemStateBuf[idx * 3 + 1],
      b: gemStateBuf[idx * 3 + 2]
    });
  }

  return cells;
}

// Helper to create a default "all off" grid.
export function createDefaultGrid(): GridState {
  return Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
}
