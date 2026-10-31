/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OWNER_TOKEN?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
