// frontend/src/lib/config.ts

// Vite exposes env vars prefixed with VITE_ on import.meta.env
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const wsUrl = import.meta.env.VITE_WS_URL;

if (!apiBaseUrl) {
  // Fail fast in dev if you forgot to set env vars
  // (In prod you may want a less noisy strategy)
  // eslint-disable-next-line no-console
  console.warn("VITE_API_BASE_URL is not set");
}

if (!wsUrl) {
  // eslint-disable-next-line no-console
  console.warn("VITE_WS_URL is not set");
}

export const API_BASE_URL = apiBaseUrl as string;
export const WS_URL = wsUrl as string;
