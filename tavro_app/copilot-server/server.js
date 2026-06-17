import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, 'skills');
const TEMPLATES_DIR = join(__dirname, 'templates');

// Strip YAML frontmatter (--- ... ---) from a markdown file.
function stripSkillFrontmatter(markdown) {
    return markdown.replace(/^---[\s\S]*?---\n*/, '').trim();
}

// Read all *.md files from a directory, strip frontmatter, and join them.
// Returns empty string when the directory does not exist or has no .md files.
function loadTemplatesFromDir(dir) {
    if (!existsSync(dir)) return '';
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter(t => t.isFile() && t.name.endsWith('.md'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(t => {
                try { return stripSkillFrontmatter(readFileSync(join(dir, t.name), 'utf-8')); }
                catch { return null; }
            })
            .filter(Boolean)
            .join('\n\n');
    } catch { return ''; }
}

// Load and concatenate all SKILL.md files found in immediate subdirectories of SKILLS_DIR.
// Prepends the root-level PDF document template so every AI session knows the
// master formatting rules before any skill-specific instructions.
function loadSkillsContent() {
    try {
        if (!existsSync(SKILLS_DIR)) return null;

        // Master PDF template — applies to all document generation
        const masterTemplate = loadTemplatesFromDir(TEMPLATES_DIR);

        const skillParts = readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => {
                try {
                    return stripSkillFrontmatter(
                        readFileSync(join(SKILLS_DIR, e.name, 'SKILL.md'), 'utf-8')
                    );
                } catch { return null; }
            })
            .filter(Boolean);

        if (!skillParts.length && !masterTemplate) return null;

        const parts = [];
        if (masterTemplate) parts.push(masterTemplate);
        parts.push(...skillParts);
        return parts.join('\n\n');
    } catch {
        return null;
    }
}

const SKILL_CONTENT = loadSkillsContent();
if (SKILL_CONTENT) {
    console.log(`[copilot-proxy] Loaded skill instructions (${SKILL_CONTENT.length} chars)`);
} else {
    console.log('[copilot-proxy] No skill instructions loaded');
}

const PORT = Number(process.env.PORT || 4000);

// Docker-internal URL for the Tavro MCP server.
// Within the Docker network the service is reachable at its service name.
// Override via MCP_INTERNAL_URL env var when deploying outside Docker or to a
// different host.
const MCP_INTERNAL_URL = process.env.MCP_INTERNAL_URL || 'http://risk-mcp-server:9001/zitadel/mcp';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

let client;
let clientStarted = false;
const sessions = new Map();

// ── In-flight response cache ───────────────────────────────────────────────────
// Keyed by requestId supplied by the browser. Each entry holds an EventEmitter
// so that a reconnecting browser can replay already-streamed chunks and then
// tail the live stream — all without restarting the backend request.
const pendingResponses = new Map();
const RESPONSE_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
    const cutoff = Date.now() - RESPONSE_TTL_MS;
    for (const [id, entry] of pendingResponses) {
        if (entry.createdAt < cutoff) pendingResponses.delete(id);
    }
}, 2 * 60 * 1000).unref();

/**
 * Create a new cache entry for a streaming response.
 * The emitter fires: 'chunk' (string), 'done' (), 'error' (string).
 */
function createResponseEntry() {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    return { emitter, chunks: [], fullText: '', status: 'streaming', error: null, createdAt: Date.now() };
}

/**
 * Build disconnect-safe sendEvent / sendDone / sendError helpers.
 *
 * If requestId is provided a cache entry is registered so a reconnecting
 * client can replay all chunks even after the original browser connection drops.
 * The backend fetch continues regardless of whether the browser is still connected.
 */
function makeCachedSSE(res, req, requestId) {
    let entry = null;
    if (requestId) {
        entry = createResponseEntry();
        pendingResponses.set(requestId, entry);
    }

    let clientConnected = true;
    req.on('close', () => { clientConnected = false; });

    const safeWrite = (payload) => {
        if (clientConnected && !res.destroyed) {
            try { res.write(payload); } catch { clientConnected = false; }
        }
    };

    const sendEvent = (data) => {
        if (entry && data.delta) {
            entry.chunks.push(data.delta);
            entry.fullText += data.delta;
            entry.emitter.emit('chunk', data.delta);
        }
        safeWrite(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendDone = () => {
        if (entry) {
            entry.status = 'complete';
            entry.emitter.emit('done');
        }
        safeWrite('data: [DONE]\n\n');
        if (clientConnected && !res.destroyed) { try { res.end(); } catch {} }
    };

    const sendError = (message) => {
        if (entry) {
            entry.status = 'error';
            entry.error = message;
            entry.emitter.emit('error', message);
        }
        safeWrite(`data: ${JSON.stringify({ error: message })}\n\n`);
        if (clientConnected && !res.destroyed) { try { res.end(); } catch {} }
    };

    return { sendEvent, sendDone, sendError };
}

function isAuthError(message) {
    return /401|unauthori[sz]ed|Failed to fetch Copilot user info|not created with authentication info|token/i.test(message);
}

async function ensureClientStarted() {
    if (clientStarted) return;
    client = new CopilotClient({
        autoStart: false,
        logLevel: 'warning',
        useLoggedInUser: false,
    });
    await client.start();
    clientStarted = true;
}

function renderChatPrompt(messages) {
    return messages.map((message) => {
        const content = typeof message.content === 'string'
            ? message.content
            : message.content == null
                ? ''
                : JSON.stringify(message.content);
        switch (message.role) {
            case 'system':    return `System: ${content}`;
            case 'assistant': return `Assistant: ${content}`;
            case 'user':      return `User: ${content}`;
            case 'tool':      return `Tool ${message.name || message.tool_call_id || ''}: ${content}`;
            default:          return `${message.role}: ${content}`;
        }
    }).join('\n');
}

function pickString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

function hasCustomProvider(provider) {
    return !!(provider && provider.type);
}

function extractEventContent(event) {
    const data = event?.data ?? {};
    return pickString(
        data.content,
        data.deltaContent,
        data.delta,
        data.message?.content,
        data.message?.text,
        data.choices?.[0]?.message?.content,
        data.choices?.[0]?.delta?.content,
    );
}

/**
 * Build the Copilot SDK provider config from the request body's `provider` field.
 * Supports openai, azure, and anthropic BYOK providers.
 */
function buildProviderConfig(provider) {
    if (!provider || !provider.type) return null;
    const cfg = { type: provider.type };
    if (provider.baseUrl) {
        cfg.baseUrl = provider.baseUrl;
    } else if (provider.type === 'openai') {
        cfg.baseUrl = 'https://api.openai.com/v1';
    } else if (provider.type === 'anthropic') {
        cfg.baseUrl = 'https://api.anthropic.com';
    }
    if (provider.apiKey)       cfg.apiKey       = provider.apiKey;
    if (provider.bearerToken)  cfg.bearerToken  = provider.bearerToken;
    if (provider.wireApi)      cfg.wireApi      = provider.wireApi;
    if (provider.azure?.apiVersion) cfg.azure   = { apiVersion: provider.azure.apiVersion };
    if (provider.modelId)      cfg.modelId      = provider.modelId;
    if (provider.wireModel)    cfg.wireModel    = provider.wireModel;
    if (provider.maxInputTokens)  cfg.maxInputTokens  = provider.maxInputTokens;
    if (provider.maxOutputTokens) cfg.maxOutputTokens = provider.maxOutputTokens;
    return cfg;
}

function buildModelCapabilities(provider) {
    if (!provider || !provider.type) return undefined;
    if (provider.modelCapabilities) return provider.modelCapabilities;

    if (provider.type === 'anthropic') {
        return {
            supports: {
                vision: false,
                reasoningEffort: false,
            },
        };
    }

    return undefined;
}

/**
 * Inject SKILL_CONTENT into a pre-formatted BYOK request body.
 * Handles both Anthropic (system string) and OpenAI/Azure (messages array) formats.
 */
function injectSkillIntoByokBody(providerType, body) {
    if (!SKILL_CONTENT || !body) return body;
    console.log(`[skill] injecting into byok body (type=${providerType})`);
    const modified = { ...body };
    if (providerType === 'anthropic') {
        const existing = typeof modified.system === 'string' ? modified.system : '';
        modified.system = existing ? `${SKILL_CONTENT}\n\n${existing}` : SKILL_CONTENT;
    } else {
        // OpenAI / Azure: prepend or insert a system message
        const messages = Array.isArray(modified.messages) ? [...modified.messages] : [];
        const sysIdx = messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) {
            const existing = typeof messages[sysIdx].content === 'string' ? messages[sysIdx].content : '';
            messages[sysIdx] = {
                ...messages[sysIdx],
                content: existing ? `${SKILL_CONTENT}\n\n${existing}` : SKILL_CONTENT,
            };
        } else {
            messages.unshift({ role: 'system', content: SKILL_CONTENT });
        }
        modified.messages = messages;
    }
    return modified;
}

/**
 * Inject SKILL_CONTENT into a Gemini API request body via systemInstruction.
 */
function injectSkillIntoGeminiBody(body) {
    if (!SKILL_CONTENT || !body) return body;
    console.log('[skill] injecting into gemini body');
    const modified = { ...body };
    const existing = modified.systemInstruction?.parts?.[0]?.text;
    modified.systemInstruction = {
        role: 'user',
        parts: [{ text: existing ? `${SKILL_CONTENT}\n\n${existing}` : SKILL_CONTENT }],
    };
    return modified;
}

/**
 * Build the session config, merging GitHub auth, optional BYOK provider, and
 * optional Tavro MCP server credentials.
 *
 * mcpConfig: { token: string, tenantId?: string } | null
 *   When provided (and no BYOK provider is set), the Tavro MCP server is
 *   registered with the session so the SDK can call Tavro tools automatically
 *   without manual orchestration on the frontend.
 */
function buildSessionConfig(model, authToken, provider, systemPrompt, sessionId, mcpConfig) {
    const providerCfg = buildProviderConfig(provider);
    const cfg = {
        model,
        sessionId,
        streaming: true,
        onPermissionRequest: approveAll,
        useLoggedInUser: false,
        // availableTools not restricted — SDK uses all tools exposed by registered
        // MCP servers and its own built-in capabilities.
    };
    // Prepend skill instructions to the system prompt for all SDK sessions.
    // skillDirectories also registers the skills natively with the Copilot SDK.
    if (SKILL_CONTENT) console.log('[skill] injecting into SDK session config');
    const effectiveSystemPrompt = SKILL_CONTENT
        ? (systemPrompt ? `${SKILL_CONTENT}\n\n${systemPrompt}` : SKILL_CONTENT)
        : systemPrompt;
    if (effectiveSystemPrompt) {
        cfg.systemMessage = {
            mode: 'replace',
            content: effectiveSystemPrompt,
        };
    }
    if (existsSync(SKILLS_DIR)) {
        cfg.skillDirectories = [SKILLS_DIR];
    }
    if (authToken) {
        cfg.gitHubToken = authToken;
        cfg.githubToken = authToken;
    }
    if (providerCfg) cfg.provider = providerCfg;
    const modelCapabilities = buildModelCapabilities(provider);
    if (modelCapabilities) cfg.modelCapabilities = modelCapabilities;

    // Wire the Tavro MCP server into the session for the GitHub Copilot SDK
    // path (non-BYOK).  BYOK sessions keep the frontend orchestrator handling
    // tool calls; only SDK-native sessions gain internal MCP routing here.
    if (mcpConfig?.token && !provider && MCP_INTERNAL_URL) {
        const mcpHeaders = {
            'Authorization': `Bearer ${mcpConfig.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'ngrok-skip-browser-warning': 'true',
        };
        if (mcpConfig.tenantId) mcpHeaders['tenant_id'] = mcpConfig.tenantId;
        cfg.mcpServers = {
            'tavro-mcp': {
                type: 'http',
                url: MCP_INTERNAL_URL,
                tools: ['*'],
                headers: mcpHeaders,
            },
        };
    }

    return cfg;
}

function isAdaptiveThinkingError(message) {
    return /adaptive thinking is not supported/i.test(message || '');
}

function splitPromptMessages(messages) {
    const systemPrompt = messages
        .filter((message) => message.role === 'system')
        .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''))
        .join('\n\n');
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const prompt = lastUser
        ? (typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content ?? ''))
        : renderChatPrompt(messages);
    return { systemPrompt, prompt };
}

function sessionCacheKey({ sessionId, model, provider, hasMcp }) {
    const providerType = provider?.type || 'github';
    const providerBase = provider?.baseUrl || '';
    // hasMcp is included so sessions with/without MCP are never shared.
    return `${sessionId || 'default'}::${providerType}::${providerBase}::${model}::${hasMcp ? 'mcp' : 'nomcp'}`;
}

async function getOrCreateSession({ sessionId, model, authToken, provider, messages, mcpConfig }) {
    const hasMcp = !!(mcpConfig?.token);
    const cacheKey = sessionCacheKey({ sessionId, model, provider, hasMcp });
    const cached = sessions.get(cacheKey);
    if (cached?.session) return cached.session;

    const { systemPrompt } = splitPromptMessages(messages);
    const session = await client.createSession(buildSessionConfig(model, authToken, provider, systemPrompt, sessionId, mcpConfig));
    sessions.set(cacheKey, {
        session,
        lastUsed: Date.now(),
    });
    return session;
}

// ── POST /chat/complete — non-streaming, returns JSON ──────────────────────────

app.post('/chat/complete', async (req, res) => {
    const { model, apiKey, messages, provider, sessionId, mcpToken, mcpTenantId } = req.body ?? {};

    if (!model) return res.status(400).json({ error: 'Missing model' });
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'Missing messages array' });

    const providerCfg = hasCustomProvider(provider) ? { ...provider, apiKey: provider.apiKey || apiKey } : null;
    const authToken = hasCustomProvider(providerCfg) ? '' : pickString(apiKey);
    if (!authToken && !hasCustomProvider(providerCfg)) {
        return res.status(400).json({
            error: 'Missing GitHub Copilot token. Save a Copilot-enabled GitHub token in Settings for the GitHub Copilot SDK provider.',
        });
    }

    // MCP credentials — only used for the non-BYOK (GitHub Copilot SDK) path.
    const mcpConfig = mcpToken ? { token: mcpToken, tenantId: mcpTenantId || '' } : null;

    try {
        await ensureClientStarted();
        console.log(`[copilot-proxy] /chat/complete model=${model} session=${sessionId || 'default'} messages=${messages.length}${providerCfg ? ` byok=${providerCfg.type}` : ''}${mcpConfig ? ' mcp=true' : ''}`);

        const fallbackModels = ['gpt-4.1', 'gpt-4o', 'claude-sonnet-4.5', 'gpt-5'];
        const candidates = providerCfg ? [model] : [model, ...fallbackModels.filter(m => m !== model)];
        let chosenModel = model;
        let session = null;
        let lastError = null;

        for (const candidate of candidates) {
            try {
                session = await getOrCreateSession({ sessionId, model: candidate, authToken, provider: providerCfg, messages, mcpConfig });
                chosenModel = candidate;
                if (candidate !== model) {
                    console.warn(`[copilot-proxy] falling back from ${model} to ${candidate}`);
                }
                break;
            } catch (err) {
                lastError = err;
                const msg = err?.message ?? String(err);
                if (!msg.includes('Model') || !msg.includes('not available')) throw err;
            }
        }

        if (!session) throw lastError || new Error('Failed to create Copilot session.');

        const { prompt } = splitPromptMessages(messages);
        let streamedContent = '';
        const unsub = session.on('assistant.message_delta', (event) => {
            streamedContent += extractEventContent(event);
        });
        let event;
        try {
            event = await session.sendAndWait({ prompt }, 120000);
        } finally {
            if (typeof unsub === 'function') unsub();
        }

        const content = (extractEventContent(event) || streamedContent).trim();
        if (!content) {
            console.error('[copilot-proxy] empty content', { model, chosenModel, eventType: event?.type });
            return res.status(500).json({
                error: 'Copilot SDK proxy returned no assistant content.',
                eventType: event?.type,
            });
        }
        return res.json({ type: 'text', content, model: chosenModel });
    } catch (err) {
        const message = err?.message ?? String(err);
        console.error('[copilot-proxy] /chat/complete failed', { message });
        if (providerCfg?.type === 'anthropic' && isAdaptiveThinkingError(message)) {
            return res.status(500).json({ error: message });
        }
        const status = isAuthError(message) ? 401 : 500;
        return res.status(status).json({
            error: message,
            ...(status === 401 && {
                authHelp: 'GitHub Copilot authentication failed. Provide a Copilot-enabled GitHub token. Classic ghp_ PATs are not supported.',
            }),
        });
    }
});

// ── POST /chat/stream — SSE streaming ─────────────────────────────────────────

app.post('/chat/stream', async (req, res) => {
    const { model, apiKey, messages, provider, sessionId, mcpToken, mcpTenantId, requestId } = req.body ?? {};

    if (!model || !Array.isArray(messages)) {
        res.status(400).json({ error: 'Missing model or messages' });
        return;
    }

    const providerCfg = hasCustomProvider(provider) ? { ...provider, apiKey: provider.apiKey || apiKey } : null;
    const authToken = hasCustomProvider(providerCfg) ? '' : pickString(apiKey);
    if (!authToken && !hasCustomProvider(providerCfg)) {
        res.status(400).json({ error: 'Missing GitHub Copilot token.' });
        return;
    }

    const mcpConfig = mcpToken ? { token: mcpToken, tenantId: mcpTenantId || '' } : null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { sendEvent, sendDone, sendError } = makeCachedSSE(res, req, requestId || null);

    try {
        await ensureClientStarted();
        console.log(`[copilot-proxy] /chat/stream model=${model} session=${sessionId || 'default'} messages=${messages.length}${providerCfg ? ` byok=${providerCfg.type}` : ''}${mcpConfig ? ' mcp=true' : ''}${requestId ? ` rid=${requestId}` : ''}`);

        const session = await getOrCreateSession({ sessionId, model, authToken, provider: providerCfg, messages, mcpConfig });

        let streamedContent = '';
        const unsub = session.on('assistant.message_delta', (event) => {
            const delta = extractEventContent(event);
            if (delta) {
                streamedContent += delta;
                sendEvent({ delta });
            }
        });

        let event;
        try {
            const { prompt } = splitPromptMessages(messages);
            event = await session.sendAndWait({ prompt }, 120000);
        } finally {
            if (typeof unsub === 'function') unsub();
        }

        if (!streamedContent) {
            const content = extractEventContent(event);
            if (content) sendEvent({ delta: content });
        }
        sendDone();
    } catch (err) {
        const message = err?.message ?? String(err);
        console.error('[copilot-proxy] /chat/stream failed', { message });
        if (providerCfg?.type === 'anthropic' && isAdaptiveThinkingError(message)) {
            sendError(message);
            return;
        }
        sendError(message);
    }
});

// ── BYOK helpers ──────────────────────────────────────────────────────────────

function safeJsonParse(str) {
    try { return JSON.parse(str || '{}'); } catch { return {}; }
}

/**
 * Build auth + content-type headers for the upstream BYOK API call.
 * providerType: 'openai' | 'azure' | 'anthropic'
 */
function buildUpstreamHeaders(providerType, apiKey, bearerToken) {
    const h = { 'Content-Type': 'application/json' };
    switch (providerType) {
        case 'anthropic':
            h['x-api-key']        = apiKey;
            h['anthropic-version'] = '2023-06-01';
            break;
        case 'azure':
            h['api-key'] = apiKey;
            break;
        case 'openai':
        default:
            h['Authorization'] = `Bearer ${bearerToken || apiKey}`;
            break;
    }
    return h;
}

async function completeAnthropicDirect({ model, apiKey, messages }) {
    const prompt = renderChatPrompt(messages);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: buildUpstreamHeaders('anthropic', apiKey),
        body: JSON.stringify({
            model,
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }],
        }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        const msg = data?.error?.message ?? data?.error ?? `Upstream ${upstream.status}`;
        throw new Error(msg);
    }
    return (data.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('');
}

async function streamAnthropicDirect({ model, apiKey, messages, sendEvent, sendDone }) {
    const prompt = renderChatPrompt(messages);
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: buildUpstreamHeaders('anthropic', apiKey),
        body: JSON.stringify({
            model,
            max_tokens: 8192,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
        }),
    });

    if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({}));
        const msg = data?.error?.message ?? data?.error ?? `Upstream ${upstream.status}`;
        throw new Error(msg);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const raw = trimmed.slice(5).trim();
            if (raw === '[DONE]') {
                sendDone();
                return;
            }
            try {
                const parsed = JSON.parse(raw);
                const delta = parsed?.delta?.text ?? '';
                if (delta) sendEvent({ delta });
            } catch {
                // skip malformed chunks
            }
        }
    }
    sendDone();
}

// ── POST /chat/byok/complete — server-side BYOK non-streaming ─────────────────
//
// Routes BYOK API calls (OpenAI / Azure / Anthropic) through the proxy server
// so browsers never make cross-origin requests directly to those APIs (CORS fix).
//
// Body:
//   providerType  'openai' | 'azure' | 'anthropic'
//   endpoint      Full URL to call (e.g. https://api.anthropic.com/v1/messages)
//   apiKey        API key for the provider
//   bearerToken?  Optional bearer token (openai/azure, overrides apiKey)
//   body          Already-formatted request body (provider wire format)

app.post('/chat/byok/complete', async (req, res) => {
    const { providerType, endpoint: rawEndpoint, apiKey: reqApiKey, bearerToken, body } = req.body ?? {};
    const apiKey = reqApiKey || (
        providerType === 'openai'    ? process.env.OPENAI_API_KEY :
        providerType === 'azure'     ? process.env.AZURE_AI_FOUNDRY_KEY :
        providerType === 'anthropic' ? process.env.ANTHROPIC_API_KEY :
        ''
    );
    // Azure: prepend admin-configured endpoint when frontend sends only the path (no base URL).
    const endpoint = (providerType === 'azure' && rawEndpoint && !rawEndpoint.startsWith('https://'))
        ? `${(process.env.AZURE_AI_FOUNDRY_ENDPOINT || '').replace(/\/$/, '')}${rawEndpoint}`
        : rawEndpoint;

    if (!endpoint || !body)     return res.status(400).json({ error: 'Missing endpoint or body' });
    if (!endpoint.startsWith('https://')) return res.status(400).json({ error: 'Only HTTPS endpoints allowed' });

    console.log(`[copilot-byok] /chat/byok/complete type=${providerType} endpoint=${endpoint}`);

    try {
        const enrichedBody = injectSkillIntoByokBody(providerType, body);
        const upstream = await fetch(endpoint, {
            method:  'POST',
            headers: buildUpstreamHeaders(providerType, apiKey, bearerToken),
            body:    JSON.stringify(enrichedBody),
        });

        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
            const msg = data?.error?.message ?? data?.error ?? `Upstream ${upstream.status}`;
            console.error(`[copilot-byok] upstream error ${upstream.status}`, { msg });
            return res.status(upstream.status).json({ error: msg });
        }
        const stopReason = data?.stop_reason ?? 'unknown';
        const contentCount = Array.isArray(data?.content) ? data.content.length : 0;
        const contentTypes = Array.isArray(data?.content) ? data.content.map(c => c?.type).join(',') : 'none';
        console.log(`[copilot-byok] response stop_reason=${stopReason} content_blocks=${contentCount} types=${contentTypes}`);
        return res.json(data);
    } catch (err) {
        console.error('[copilot-byok] /chat/byok/complete fetch failed', { error: err.message });
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /chat/byok/stream — server-side BYOK SSE streaming ──────────────────
//
// Same as /chat/byok/complete but streams SSE deltas back to the browser.
// Accepts an optional requestId for response caching and client reconnection.

app.post('/chat/byok/stream', async (req, res) => {
    const { providerType, endpoint: rawEndpoint, apiKey: reqApiKey, bearerToken, body, requestId } = req.body ?? {};
    const apiKey = reqApiKey || (
        providerType === 'openai'    ? process.env.OPENAI_API_KEY :
        providerType === 'azure'     ? process.env.AZURE_AI_FOUNDRY_KEY :
        providerType === 'anthropic' ? process.env.ANTHROPIC_API_KEY :
        ''
    );
    // Azure: prepend admin-configured endpoint when frontend sends only the path (no base URL).
    const endpoint = (providerType === 'azure' && rawEndpoint && !rawEndpoint.startsWith('https://'))
        ? `${(process.env.AZURE_AI_FOUNDRY_ENDPOINT || '').replace(/\/$/, '')}${rawEndpoint}`
        : rawEndpoint;

    if (!endpoint || !body) { res.status(400).json({ error: 'Missing endpoint or body' }); return; }
    if (!endpoint.startsWith('https://')) { res.status(400).json({ error: 'Only HTTPS endpoints allowed' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { sendEvent, sendDone, sendError } = makeCachedSSE(res, req, requestId || null);

    console.log(`[copilot-byok] /chat/byok/stream type=${providerType} endpoint=${endpoint}${requestId ? ` rid=${requestId}` : ''}`);

    try {
        const enrichedBody = injectSkillIntoByokBody(providerType, body);
        const upstream = await fetch(endpoint, {
            method:  'POST',
            headers: buildUpstreamHeaders(providerType, apiKey, bearerToken),
            body:    JSON.stringify({ ...enrichedBody, stream: true }),
        });

        if (!upstream.ok) {
            const err = await upstream.json().catch(() => ({}));
            const msg = err?.error?.message ?? err?.error ?? `Upstream ${upstream.status}`;
            console.error(`[copilot-byok] stream upstream error ${upstream.status}`, { msg });
            sendError(msg);
            return;
        }

        // Re-emit SSE deltas from the upstream API to the browser
        const reader  = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') { sendDone(); return; }
                try {
                    const parsed = JSON.parse(raw);
                    // Anthropic: delta.text  |  OpenAI/Azure: choices[0].delta.content
                    const delta = providerType === 'anthropic'
                        ? (parsed?.delta?.text ?? '')
                        : (parsed?.choices?.[0]?.delta?.content ?? '');
                    if (delta) sendEvent({ delta });
                } catch { /* skip malformed chunks */ }
            }
        }
        sendDone();
    } catch (err) {
        console.error('[copilot-byok] /chat/byok/stream failed', { error: err.message });
        sendError(err.message ?? String(err));
    }
});

// ── POST /chat/proxy/gemini — Gemini streaming proxy with response caching ────
//
// Proxies SSE streaming requests to the Gemini API. Uses a different endpoint
// structure and delta extraction path than OpenAI/Anthropic, so it needs its
// own route. Supports the same requestId-based caching as the other endpoints.

app.post('/chat/proxy/gemini', async (req, res) => {
    const { model, apiKey, body: geminiBody, requestId } = req.body ?? {};

    if (!model || !apiKey || !geminiBody) {
        res.status(400).json({ error: 'Missing model, apiKey, or body' });
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?key=${apiKey}&alt=sse`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { sendEvent, sendDone, sendError } = makeCachedSSE(res, req, requestId || null);

    console.log(`[copilot-proxy] /chat/proxy/gemini model=${model}${requestId ? ` rid=${requestId}` : ''}`);

    try {
        const enrichedGeminiBody = injectSkillIntoGeminiBody(geminiBody);
        const upstream = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(enrichedGeminiBody),
        });

        if (!upstream.ok) {
            const err = await upstream.json().catch(() => ({}));
            const msg = err?.error?.message ?? `Gemini error ${upstream.status}`;
            console.error('[copilot-proxy] /chat/proxy/gemini upstream error', { msg });
            sendError(msg);
            return;
        }

        const reader  = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') { sendDone(); return; }
                try {
                    const parsed = JSON.parse(raw);
                    const delta = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                    if (delta) sendEvent({ delta });
                } catch { /* skip malformed */ }
            }
        }
        sendDone();
    } catch (err) {
        console.error('[copilot-proxy] /chat/proxy/gemini failed', { error: err.message });
        sendError(err.message ?? String(err));
    }
});

// ── GET /chat/resume/:requestId — reconnect to an in-flight or cached response ─
//
// When the browser refreshes or switches tabs mid-stream, the original SSE
// connection is lost. This endpoint lets the browser reconnect using the same
// requestId. It replays all chunks already buffered, then tails the live stream
// if the request is still in progress.

app.get('/chat/resume/:requestId', (req, res) => {
    const { requestId } = req.params;
    const entry = pendingResponses.get(requestId);

    if (!entry) {
        return res.status(404).json({ error: 'not_found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write  = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
    const finish = () => { try { res.write('data: [DONE]\n\n'); res.end(); } catch {} };

    // Replay all chunks already received before this reconnect
    for (const chunk of entry.chunks) {
        write({ delta: chunk });
    }

    if (entry.status === 'complete') { finish(); return; }
    if (entry.status === 'error')    { write({ error: entry.error || 'Request failed' }); res.end(); return; }

    // Request is still streaming — tail the live emitter
    const onChunk = (chunk) => write({ delta: chunk });
    const onDone  = () => finish();
    const onError = (msg) => { write({ error: msg }); res.end(); };

    entry.emitter.on('chunk', onChunk);
    entry.emitter.on('done',  onDone);
    entry.emitter.on('error', onError);

    req.on('close', () => {
        entry.emitter.off('chunk', onChunk);
        entry.emitter.off('done',  onDone);
        entry.emitter.off('error', onError);
    });
});

// ── Spark idea generation ─────────────────────────────────────────────────────
//
// POST /spark/generate/stream
//
// Routes Spark idea generation through the same Anthropic infrastructure used
// by the AI Assistant, ensuring consistent model config and skill injection.
//
// Body:
//   mode          'gap' | 'direction'
//   candidates    [{node_id, label, category, summary, signal_type, signal_label, similar_agents?}]  (gap mode)
//   companyNodes  [{node_id, label, category, summary}]  (direction mode)
//   direction     string  (direction mode)
//   companyName   string
//   industry      string
//   region        string
//   edges         [{source_label, target_label, rel_type}]
//   ideaCount     number
//   similarAgents [{agent_id, agent_name}]  (included in gap-mode ideas)

function sparkIdeaId(nodeId, signalType, direction) {
    let raw = `${nodeId}:${signalType}`;
    if (direction) raw += `:${String(direction).trim().toLowerCase()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function buildSparkGapPrompt(candidates, direction, companyName, industry, region, edges) {
    const companyLabel = companyName || 'the company';
    const industryLabel = industry || 'enterprise operations';
    const regionClause = region ? ` (${region})` : '';
    const currentYear = new Date().getFullYear();

    const signals = candidates.map((c, i) => ({
        index: i,
        label: c.label,
        category: c.category,
        summary: c.summary || '',
        signal_label: c.signal_label,
    }));

    const directionClause = direction && direction.trim()
        ? `\n\nFOCUS DIRECTION (user-specified): "${direction}"\nAll ideas MUST be relevant to this focus area. If a signal is not naturally connected to it, find the angle that links it — do not generate an off-topic idea just to fill the slot.`
        : '';

    const edgeContext = edges && edges.length > 0
        ? '\n\nDimension relationships (how the company\'s systems and processes connect — use these to ground ideas in real dependencies and integration surfaces):\n' +
          edges.slice(0, 30).map(e => `  ${e.source_label} —[${e.rel_type}]→ ${e.target_label}`).join('\n')
        : '';

    const system = [
        `You are a senior AI implementation consultant specialising in ${industryLabel}.`,
        `You are analysing ${companyLabel}${regionClause}, a ${industryLabel} company.`,
        'Your job is to identify specific, high-ROI AI use case ideas that can realistically be implemented in 3–18 months.',
        `Today's year is ${currentYear}.`,
        `NEVER reference goals, targets, revenue plans, or milestones tied to years before ${currentYear}.`,
        'If a signal mentions a past-year goal (e.g. FY2024, FY2025), ignore the goal framing and focus on the underlying system or process instead.',
        directionClause,
        '\n\nA GOOD idea:\n  • Names one specific AI capability — anomaly detection, document extraction, predictive classification, NLP triage, demand forecasting, quality inspection, work order routing, root-cause analysis, etc.\n  • References the exact system or process in the context (use its label and category)\n  • Describes concretely what input data flows in and what specific output or decision is produced\n  • States a measurable ROI hook: hours saved per week, defect rate reduction, cost avoidance, decision speed-up\n  • Is achievable by a small team (2–5 engineers) using current AI APIs and tools\n\nA BAD idea (never generate these):\n  • Vague: \'leverage AI\', \'harness machine learning\', \'build an AI platform\', \'explore opportunities\'\n  • Time-expired: references FY2024, FY2025, or any past-year target\n  • Scope-inflated: describes a full enterprise programme with no specific agent\n  • Disconnected: idea has no real link to the specific system named in the context signal',
    ].join(' ');

    const companyHeader = `Company: ${companyLabel} | Industry: ${industryLabel}${region ? ` | Region: ${region}` : ''}\n\n`;
    const user = [
        companyHeader,
        'For each signal below, generate ONE specific AI use case idea as a JSON object with exactly these fields:\n',
        '- title: formal AI use case title, max 8 words. Do NOT include the word \'Agent\'. Do NOT write an agent name. (good: \'MES Downtime Root-Cause Classification\'; bad: \'MES Downtime Agent\')\n',
        '- description: exactly 2 sentences — sentence 1: what the agent does and which specific system/process it connects to; sentence 2: what output it produces and how a user or downstream system acts on it\n',
        '- rationale: 1 sentence — the specific ROI or risk reduction, quantified where possible (e.g. \'saves ~6 hrs/week of manual triage\', \'reduces scrap rate by ~15%\', \'cuts invoice processing from 3 days to 4 hours\')\n',
        '- complexity: exactly one of \'Low\', \'Medium\', or \'High\'\n',
        '  Low = uses existing AI APIs with no custom training, deployable in <8 weeks\n',
        '  Medium = requires fine-tuning, custom pipeline, or multi-system integration, 2–6 months\n',
        '  High = real-time ML, on-premise OT integration, or significant data engineering, 6–18 months\n',
        '- estimated_impact: exactly one of \'Low\', \'Medium\', or \'High\'\n',
        '  High = saves >$50K/yr or prevents critical production or compliance risk\n',
        '  Medium = saves $10–50K/yr or eliminates significant manual work\n',
        '  Low = incremental improvement, <$10K/yr\n\n',
        `Signals:\n${JSON.stringify(signals, null, 2)}`,
        edgeContext,
        '\n\nReturn ONLY a JSON array with one object per signal, same order. No prose, no markdown fences.',
    ].join('');

    return [system, user];
}

function buildSparkDirectionPrompt(companyNodes, direction, count, companyName, industry, region, edges) {
    const companyLabel = companyName || 'the company';
    const industryLabel = industry || 'enterprise operations';
    const regionClause = region ? ` (${region})` : '';
    const currentYear = new Date().getFullYear();

    const contextLines = (companyNodes || []).map(c =>
        `  [${String(c.category).toUpperCase()}] ${c.label}${c.summary ? ': ' + c.summary : ''}`
    ).join('\n');

    const edgeLines = edges && edges.length > 0
        ? '\n\nDimension relationships (how systems and processes connect):\n' +
          edges.slice(0, 30).map(e => `  ${e.source_label} —[${e.rel_type}]→ ${e.target_label}`).join('\n')
        : '';

    const system = [
        `You are a senior AI implementation consultant specialising in ${industryLabel}.`,
        `You are analysing ${companyLabel}${regionClause}, a ${industryLabel} company.`,
        `Today's year is ${currentYear}. Never reference past-year goals or stale targets.`,
        'Generate specific, concrete, buildable AI use case ideas with measurable ROI.',
        'Do not generate agents here. Do not include agent names in titles.',
        'Each idea must name one specific AI capability — not vague phrases like \'leverage AI\'.',
    ].join(' ');

    const companyHeader = `Company: ${companyLabel} | Industry: ${industryLabel}${region ? ` | Region: ${region}` : ''}\n\n`;
    const user = [
        `FOCUS: Generate exactly ${count} distinct AI use case ideas, ALL specifically about: "${direction}"\n\n`,
        companyHeader,
        'Company context — you MUST ground each idea in one specific system or process listed below. ',
        'Name it explicitly in the description and in the source_node field:\n',
        contextLines,
        edgeLines,
        '\n\nFor each idea return a JSON object with:\n',
        '- title: formal AI use case title, max 8 words. Do NOT include the word \'Agent\'. Do NOT write an agent name. (good: \'OData Quality Gate Anomaly Detection\'; bad: \'OData Quality Gate Agent\')\n',
        '- description: exactly 2 sentences — sentence 1: what the agent does and which SPECIFIC system or process from the context above it connects to (name it exactly); sentence 2: what output it produces and how it is acted on\n',
        '- rationale: 1 sentence — specific ROI, quantified where possible (e.g. \'reduces manual data reconciliation by ~4 hrs/week\')\n',
        '- complexity: exactly \'Low\', \'Medium\', or \'High\'\n',
        '- estimated_impact: exactly \'Low\', \'Medium\', or \'High\'\n',
        '- category: one of: process, integration, application, risk, strategy, technology\n',
        '- source_node: the EXACT label of the company system or process this idea is grounded in (must match one of the labels in the context above)\n\n',
        `ALL ${count} ideas MUST be about "${direction}" AND grounded in a specific company system or process. `,
        'Return ONLY a JSON array. No prose, no markdown fences.',
    ].join('');

    return [system, user];
}

function extractCompleteSparkObjects(buffer) {
    const objects = [];
    let i = 0;
    const n = buffer.length;

    while (i < n && buffer[i] !== '[' && buffer[i] !== '{') i++;
    if (i >= n) return [objects, buffer];
    if (buffer[i] === '[') i++;

    while (i < n) {
        while (i < n && ' \t\n\r,'.includes(buffer[i])) i++;
        if (i >= n) break;
        if (buffer[i] === ']') return [objects, ''];
        if (buffer[i] !== '{') break;

        let depth = 0;
        let inString = false;
        let escapeNext = false;
        const objStart = i;
        let j = i;

        while (j < n) {
            const c = buffer[j];
            if (escapeNext) { escapeNext = false; }
            else if (c === '\\' && inString) { escapeNext = true; }
            else if (c === '"') { inString = !inString; }
            else if (!inString) {
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        try { objects.push(JSON.parse(buffer.slice(objStart, j + 1))); } catch {}
                        i = j + 1;
                        break;
                    }
                }
            }
            j++;
        }

        if (j >= n) return [objects, buffer.slice(objStart)];
    }

    return [objects, i < n ? buffer.slice(i) : ''];
}

app.post('/spark/generate/stream', async (req, res) => {
    const {
        mode,
        candidates,
        companyNodes,
        direction,
        companyName,
        industry,
        region,
        edges,
        ideaCount,
        similarAgents,
    } = req.body ?? {};

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'No Anthropic API key configured on server' });
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const safeWrite = (payload) => { try { if (!res.destroyed) res.write(payload); } catch {} };
    const count = Math.min(Number(ideaCount) || 5, 16);
    const isDirection = mode === 'direction' && direction && String(direction).trim();

    try {
        let system, user;
        let nodeMap = {};

        if (isDirection) {
            nodeMap = Object.fromEntries((companyNodes || []).map(n => [String(n.label).toLowerCase(), n]));
            [system, user] = buildSparkDirectionPrompt(companyNodes || [], direction, count, companyName, industry, region, edges);
        } else {
            [system, user] = buildSparkGapPrompt(candidates || [], direction, companyName, industry, region, edges);
        }

        console.log(`[spark] /spark/generate/stream mode=${mode || 'gap'} count=${count}`);

        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: buildUpstreamHeaders('anthropic', apiKey),
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: isDirection ? 4000 : 2000,
                system,
                messages: [{ role: 'user', content: user }],
                stream: true,
            }),
        });

        if (!upstream.ok) {
            const err = await upstream.json().catch(() => ({}));
            const msg = err?.error?.message ?? `Anthropic error ${upstream.status}`;
            safeWrite(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
            res.end();
            return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let rawBuffer = '';
        let objBuffer = '';
        let emitted = 0;
        const sharedAgents = (similarAgents || []).slice(0, 2);

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            rawBuffer += decoder.decode(value, { stream: true });
            const lines = rawBuffer.split('\n');
            rawBuffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') break outer;
                try {
                    const parsed = JSON.parse(raw);
                    const delta = parsed?.delta?.text ?? '';
                    if (!delta) continue;
                    objBuffer += delta;

                    const [objects, remaining] = extractCompleteSparkObjects(objBuffer);
                    objBuffer = remaining;

                    for (const obj of objects) {
                        if (emitted >= count) break outer;

                        let idea;
                        if (isDirection) {
                            const category = obj.category || 'process';
                            const signalType = ['integration', 'application'].includes(category)
                                ? 'integration_surface' : 'gap_coverage';
                            const innerHash = createHash('sha256')
                                .update(`${direction}:${emitted}`).digest('hex').slice(0, 8);
                            const nodeId = `dir:${innerHash}`;
                            const ideaId = sparkIdeaId(nodeId, signalType, direction);
                            const sourceLabel = String(obj.source_node || '').toLowerCase().trim();
                            const matchedNode = nodeMap[sourceLabel];
                            const targetNodes = matchedNode ? [{
                                id: matchedNode.node_id,
                                label: matchedNode.label,
                                category: matchedNode.category,
                                summary: matchedNode.summary || null,
                            }] : [];

                            idea = {
                                idea_id: ideaId,
                                title: obj.title || `AI for ${direction}`,
                                description: obj.description || '',
                                rationale: obj.rationale || '',
                                signal_type: signalType,
                                signal_label: `Focus: ${String(direction).trim()}`,
                                target_dimensions: [category],
                                target_nodes: targetNodes,
                                complexity: obj.complexity || 'Medium',
                                estimated_impact: obj.estimated_impact || 'Medium',
                                similar_agents: [],
                            };
                        } else {
                            const candidate = (candidates || [])[emitted];
                            if (!candidate) { emitted++; continue; }

                            idea = {
                                idea_id: sparkIdeaId(candidate.node_id, candidate.signal_type),
                                title: obj.title || `AI automation for ${candidate.label}`,
                                description: obj.description || '',
                                rationale: obj.rationale || candidate.signal_label,
                                signal_type: candidate.signal_type,
                                signal_label: candidate.signal_label,
                                target_dimensions: [candidate.category],
                                target_nodes: [{
                                    id: candidate.node_id,
                                    label: candidate.label,
                                    category: candidate.category,
                                    summary: candidate.summary || null,
                                }],
                                complexity: obj.complexity || 'Medium',
                                estimated_impact: obj.estimated_impact || 'Medium',
                                similar_agents: sharedAgents,
                            };
                        }

                        emitted++;
                        safeWrite(`event: idea\ndata: ${JSON.stringify(idea)}\n\n`);
                    }
                } catch { /* skip malformed SSE chunks */ }
            }
        }

        safeWrite('event: done\ndata: {}\n\n');
        res.end();
    } catch (err) {
        console.error('[spark] /spark/generate/stream failed', { error: err.message });
        safeWrite(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
    }
});

// ── GET /health ────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.status(200).send('ok'));

// ── GET /debug/skills — confirm loaded skill content (dev/debug only) ──────────

app.get('/debug/skills', (_req, res) => {
    res.json({
        loaded: !!SKILL_CONTENT,
        charCount: SKILL_CONTENT?.length ?? 0,
        skillsDir: SKILLS_DIR,
        preview: SKILL_CONTENT ? SKILL_CONTENT.slice(0, 300) + '…' : null,
    });
});

app.listen(PORT, () => {
    console.log(`[copilot-proxy] listening on port ${PORT}`);
});
