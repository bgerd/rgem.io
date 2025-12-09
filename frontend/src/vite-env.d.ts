/// <reference types="vite/client" />

// Optional: tighten types for your env vars
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  // add more here as needed, all must be readonly
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
