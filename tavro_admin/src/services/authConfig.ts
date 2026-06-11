export type AuthConfig = {
    zitadelIssuer: string;
    zitadelClientId: string;
    zitadelRedirectPath: string;
    zitadelScope: string;
};

// Falls back to VITE_ZITADEL_* if admin-specific vars aren't set,
// since the admin portal reuses the same ZITADEL app/client.
const fallbackConfig: AuthConfig = {
    zitadelIssuer: (
        import.meta.env.VITE_ADMIN_ZITADEL_ISSUER ||
        import.meta.env.VITE_ZITADEL_ISSUER ||
        ''
    ).replace(/\/$/, ''),
    zitadelClientId:
        import.meta.env.VITE_ADMIN_ZITADEL_CLIENT_ID ||
        import.meta.env.VITE_ZITADEL_CLIENT_ID ||
        '',
    zitadelRedirectPath:
        import.meta.env.VITE_ADMIN_ZITADEL_REDIRECT_PATH ||
        '/auth/callback',
    zitadelScope:
        import.meta.env.VITE_ADMIN_ZITADEL_SCOPE ||
        'openid profile email urn:zitadel:iam:user:resourceowner urn:zitadel:iam:org:project:roles',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadAuthConfig(): Promise<AuthConfig> {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
        try {
            const response = await fetch('/runtime/tavro-admin-runtime-config.json', {
                cache: 'no-store',
            });
            if (response.ok) {
                const config = (await response.json()) as Partial<AuthConfig>;
                return {
                    ...fallbackConfig,
                    ...config,
                    zitadelIssuer: (config.zitadelIssuer || fallbackConfig.zitadelIssuer).replace(/\/$/, ''),
                };
            }
        } catch {
            // Runtime config is written by the Docker ZITADEL configurator.
            // In local dev, env vars are used directly via fallbackConfig.
        }
        await sleep(1000);
    }
    return fallbackConfig;
}
