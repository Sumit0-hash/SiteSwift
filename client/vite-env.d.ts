/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASEURL: string;
  // add more like:
  // readonly VITE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
