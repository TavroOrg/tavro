import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const apiUrl = required("ZITADEL_API_URL").replace(/\/$/, "");
const tokenFile = required("ZITADEL_ADMIN_TOKEN_FILE");
const runtimeConfigFile = required("TAVRO_RUNTIME_CONFIG_FILE");
const issuer = required("VITE_ZITADEL_ISSUER").replace(/\/$/, "");
const requestHost = process.env.ZITADEL_REQUEST_HOST;
const forwardedProto = process.env.ZITADEL_REQUEST_PROTO;
const projectName = process.env.ZITADEL_PROJECT_NAME || "tavro-mcp";
const appName = process.env.ZITADEL_APP_NAME || "tavro-mcp";
const redirectUris = required("ZITADEL_APP_REDIRECT_URIS")
  .split(",")
  .map((uri) => uri.trim())
  .filter(Boolean);
const postLogoutRedirectUris = required("ZITADEL_APP_POST_LOGOUT_REDIRECT_URIS")
  .split(",")
  .map((uri) => uri.trim())
  .filter(Boolean);

const body = {
  redirectUris,
  responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
  grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
  appType: "OIDC_APP_TYPE_WEB",
  authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
  postLogoutRedirectUris,
  devMode: true,
  accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
  additionalOrigins: [...new Set(postLogoutRedirectUris.map((uri) => new URL(uri).origin))],
};

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(token, path, options = {}) {
  const url = new URL(`${apiUrl}${path}`);
  const bodyText = options.body || "";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(bodyText ? { "Content-Length": Buffer.byteLength(bodyText) } : {}),
    ...(requestHost ? { Host: requestHost } : {}),
    ...(forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {}),
    ...options.headers,
  };

  const { statusCode, text } = await new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: options.method || "GET",
        headers,
      },
      (res) => {
        let responseText = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseText += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, text: responseText });
        });
      },
    );
    req.on("error", reject);
    if (bodyText) {
      req.write(bodyText);
    }
    req.end();
  });

  const data = text ? JSON.parse(text) : {};

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${statusCode} ${text}`);
  }

  return data;
}

async function readToken() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, "utf8").trim();
      if (token) {
        return token;
      }
    }

    if (attempt === 30) {
      throw new Error(
        `${tokenFile} was not created. For an existing ZITADEL volume, recreate the volume or provide a PAT with project.app.write.`,
      );
    }

    console.log(`Waiting for ZITADEL admin PAT at ${tokenFile}...`);
    await sleep(2000);
  }
}

async function findProject(token) {
  const data = await request(token, "/management/v1/projects/_search", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.result?.find((project) => project.name === projectName);
}

async function ensureProject(token) {
  const existing = await findProject(token);
  if (existing) {
    return existing.id;
  }

  const created = await request(token, "/management/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: projectName }),
  });
  return created.id;
}

function getOidcClientId(app) {
  return app.oidcConfig?.clientId || app.oidcConfig?.client_id || app.oidcConfig?.clientID || app.clientId;
}

async function findApp(token, projectId) {
  const data = await request(token, `/management/v1/projects/${projectId}/apps/_search`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.result?.find((app) => app.name === appName);
}

async function ensureApp(token, projectId) {
  const existing = await findApp(token, projectId);
  if (existing) {
    let clientId = getOidcClientId(existing);
    if (!clientId) {
      const detail = await request(token, `/management/v1/projects/${projectId}/apps/${existing.id}`);
      clientId = getOidcClientId(detail.app || detail);
    }

    return {
      appId: existing.id,
      clientId,
    };
  }

  const created = await request(token, `/management/v1/projects/${projectId}/apps/oidc`, {
    method: "POST",
    body: JSON.stringify({
      name: appName,
      ...body,
    }),
  });

  return {
    appId: created.appId || created.id,
    clientId: created.clientId,
  };
}

function writeRuntimeConfig(clientId) {
  const config = {
    zitadelIssuer: issuer,
    zitadelClientId: clientId,
    zitadelRedirectPath: process.env.VITE_ZITADEL_REDIRECT_PATH || "/auth/callback",
    zitadelScope: process.env.VITE_ZITADEL_SCOPE || "openid profile email",
  };

  fs.mkdirSync(path.dirname(runtimeConfigFile), { recursive: true });
  fs.writeFileSync(runtimeConfigFile, JSON.stringify(config, null, 2));
  console.log(`Wrote Tavro runtime auth config to ${runtimeConfigFile}`);
}

async function configure() {
  const token = await readToken();

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const projectId = await ensureProject(token);
      const { appId, clientId } = await ensureApp(token, projectId);
      if (!clientId) {
        throw new Error(`Could not determine OIDC client id for app ${appId}`);
      }

      try {
        await request(token, `/management/v1/projects/${projectId}/apps/${appId}/oidc_config`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (!error.message.includes("No changes")) {
          throw error;
        }
      }

      writeRuntimeConfig(clientId);
      console.log("Configured ZITADEL OIDC app URLs:", {
        projectId,
        appId,
        clientId,
        redirectUris,
        postLogoutRedirectUris,
      });
      return;
    } catch (error) {
      if (attempt === 30) {
        throw error;
      }
      console.log(`ZITADEL app configuration not ready yet (${error.message}); retrying...`);
      await sleep(2000);
    }
  }
}

configure().catch((error) => {
  console.error(error);
  process.exit(1);
});
