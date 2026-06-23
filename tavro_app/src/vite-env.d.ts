/// <reference types="vite/client" />

// Allow importing any .md file as a raw string via Vite's ?raw suffix.
declare module '*.md?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
    readonly VITE_MCP_URL: string;
    readonly VITE_ZITADEL_ISSUER: string;
    readonly VITE_ZITADEL_CLIENT_ID: string;
    readonly VITE_ZITADEL_REDIRECT_PATH: string;
    readonly VITE_ZITADEL_SCOPE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
