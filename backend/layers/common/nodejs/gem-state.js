// The gemState is represented as an array of 16 integers,
// where each integer represents the state of a "gem"
export const GEM_STATE_LENGTH = 16;

// The range of gemState values that map to the color wheel
// (e.g. 8 means values 1-8 map to the color wheel, and 0 is off)
export const GEM_APP_TOGGLE_RANGE = 8;

// Maps a gem state value to its corresponding RGB color on the color wheel.
export function keyColorCss(n, max) {
  const wheelPos = n * 255 / max;
  let r = 0, g = 0, b = 0;

  if (wheelPos < 85) {
    r = wheelPos * 3;
    g = 255 - wheelPos * 3;
    b = 0;
  } else if (wheelPos < 170) {
    const wp = wheelPos - 85;
    r = 255 - wp * 3;
    g = 0;
    b = wp * 3;
  } else {
    const wp = wheelPos - 170;
    r = 0;
    g = wp * 3;
    b = 255 - wp * 3;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

// Converts gemState array + timestamp into a JSON-stringified update message
// with base64-encoded binary payloads.
export function buildUpdateMessage(gemState, timestampMs) {
  // Convert gemState to 24-bit RGB array, then to 48-byte buffer
  const gemStateBuf = new Uint8Array(GEM_STATE_LENGTH * 3);
  for (let i = 0; i < GEM_STATE_LENGTH; i++) {
    if (gemState[i] === 0) {
      gemStateBuf.set([0, 0, 0], i * 3);
    } else {
      gemStateBuf.set(keyColorCss(gemState[i] - 1, GEM_APP_TOGGLE_RANGE), i * 3);
    }
  }

  // Convert timestamp to 8-byte Big Endian buffer
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(timestampMs));

  // Note: 40% less data to transmit as base64 string and skip string parsing on clients compared to sending as ISO string.
  // TODO: Reimplement JSON-based messaging protocol as a more efficient binary protocol (encoded as base64 for API Gateway transport) to reduce message size and parsing overhead on the client. (instead of using base64 here, use binary protocol directly)  
  return JSON.stringify({
    type: "update",
    gemState: Buffer.from(gemStateBuf).toString('base64'),
    ts: Buffer.from(tsBuf).toString('base64'),
  });
}
