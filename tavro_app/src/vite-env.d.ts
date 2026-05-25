/// <reference types="vite/client" />

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
