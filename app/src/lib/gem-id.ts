// src/lib/gem-id.ts

export const GEM_ID_REGEX = /^[a-zA-Z0-9-]{1,24}$/;

export function isValidGemId(id: string): boolean {
  return GEM_ID_REGEX.test(id);
}

/**
 * Extracts a gemId from a URL pathname.
 * Returns null for "/" or any path whose first segment fails isValidGemId.
 * Returns the segment string (e.g. "test-1") when valid.
 */
export function parseGemIdFromPathname(pathname: string): string | null {
  // Strip leading slash and take the first segment
  const stripped = pathname.replace(/^\/+/, "").split("/")[0];
  if (!stripped) return null;
  if (!isValidGemId(stripped)) return null;
  return stripped;
}
