import { describe, it, expect } from "vitest";
import { decodeTimestampString, decodeGemStateString, createDefaultGrid } from "./gem-state";

// Helper: encode a BigInt timestamp to base64 the same way the backend does
function encodeTimestamp(ms: number): string {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(ms));
  return btoa(String.fromCharCode(...buf));
}

// Helper: encode a 48-byte RGB buffer to base64
function encodeGemState(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("decodeTimestampString", () => {
  it("decodes a known timestamp (1700000000000)", () => {
    const b64 = encodeTimestamp(1700000000000);
    expect(decodeTimestampString(b64)).toBe(1700000000000);
  });

  it("decodes zero timestamp", () => {
    const b64 = encodeTimestamp(0);
    expect(decodeTimestampString(b64)).toBe(0);
  });

  it("decodes Number.MAX_SAFE_INTEGER", () => {
    const b64 = encodeTimestamp(Number.MAX_SAFE_INTEGER);
    expect(decodeTimestampString(b64)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("decodes a small timestamp (value = 1)", () => {
    const b64 = encodeTimestamp(1);
    expect(decodeTimestampString(b64)).toBe(1);
  });

  it("round-trips with manual encoding", () => {
    const original = 1234567890123;
    const b64 = encodeTimestamp(original);
    expect(decodeTimestampString(b64)).toBe(original);
  });

  it("throws on invalid base64 input", () => {
    expect(() => decodeTimestampString("!!!not-base64!!!")).toThrow();
  });

  it("throws on empty string (insufficient bytes for BigUint64)", () => {
    expect(() => decodeTimestampString("")).toThrow();
  });
});

describe("decodeGemStateString", () => {
  it("decodes all-off state (48 zero bytes)", () => {
    const buf = new Uint8Array(48);
    const grid = decodeGemStateString(encodeGemState(buf));
    expect(grid).toHaveLength(16);
    for (const cell of grid) {
      expect(cell).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("decodes all-white state (48 x 0xFF bytes)", () => {
    const buf = new Uint8Array(48).fill(255);
    const grid = decodeGemStateString(encodeGemState(buf));
    expect(grid).toHaveLength(16);
    for (const cell of grid) {
      expect(cell).toEqual({ r: 255, g: 255, b: 255 });
    }
  });

  it("decodes first cell red, rest off", () => {
    const buf = new Uint8Array(48);
    buf[0] = 255; // r
    const grid = decodeGemStateString(encodeGemState(buf));

    expect(grid[0]).toEqual({ r: 255, g: 0, b: 0 });
    for (let i = 1; i < 16; i++) {
      expect(grid[i]).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("decodes a known multi-cell pattern", () => {
    const buf = new Uint8Array(48);
    // Cell 0 = (10, 20, 30)
    buf[0] = 10; buf[1] = 20; buf[2] = 30;
    // Cell 1 = (40, 50, 60)
    buf[3] = 40; buf[4] = 50; buf[5] = 60;
    const grid = decodeGemStateString(encodeGemState(buf));

    expect(grid[0]).toEqual({ r: 10, g: 20, b: 30 });
    expect(grid[1]).toEqual({ r: 40, g: 50, b: 60 });
    for (let i = 2; i < 16; i++) {
      expect(grid[i]).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("always returns exactly 16 cells", () => {
    const buf = new Uint8Array(48);
    const grid = decodeGemStateString(encodeGemState(buf));
    expect(grid).toHaveLength(16);
  });

  it("returns objects with r, g, b number properties", () => {
    const buf = new Uint8Array(48);
    buf[0] = 128; buf[1] = 64; buf[2] = 32;
    const grid = decodeGemStateString(encodeGemState(buf));

    expect(typeof grid[0].r).toBe("number");
    expect(typeof grid[0].g).toBe("number");
    expect(typeof grid[0].b).toBe("number");
    expect(grid[0]).toEqual({ r: 128, g: 64, b: 32 });
  });

  it("decodes last cell (index 15) correctly", () => {
    const buf = new Uint8Array(48);
    buf[45] = 100; buf[46] = 200; buf[47] = 50;
    const grid = decodeGemStateString(encodeGemState(buf));

    expect(grid[15]).toEqual({ r: 100, g: 200, b: 50 });
    for (let i = 0; i < 15; i++) {
      expect(grid[i]).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("throws on invalid base64 input", () => {
    expect(() => decodeGemStateString("!!!not-base64!!!")).toThrow();
  });
});

describe("createDefaultGrid", () => {
  it("returns an array of 16 cells", () => {
    expect(createDefaultGrid()).toHaveLength(16);
  });

  it("all cells are {r: 0, g: 0, b: 0}", () => {
    for (const cell of createDefaultGrid()) {
      expect(cell).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it("returns a new array on each call (no shared references)", () => {
    const grid1 = createDefaultGrid();
    const grid2 = createDefaultGrid();
    expect(grid1).not.toBe(grid2);
  });

  it("cell objects are independent (no shared references)", () => {
    const grid = createDefaultGrid();
    grid[0].r = 255;
    expect(grid[1].r).toBe(0);
  });
});
