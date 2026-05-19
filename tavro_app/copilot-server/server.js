import express from 'express';
import cors from 'cors';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

const PORT = Number(process.env.PORT || 4000);
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

let client;
let clientStarted = false;
const sessions = new Map();

const ANTHROPIC_SDK_MODEL_ALIASES = {
    'claude-sonnet-4-5': 'claude-sonnet-4-20250514',
};

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

function resolveSdkModel(model, provider) {
    if (provider?.type === 'anthropic') {
        return ANTHROPIC_SDK_MODEL_ALIASES[model] || model;
    }
    return model;
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
 * Build the session config, merging GitHub auth and optional BYOK provider.
 */
function buildSessionConfig(model, authToken, provider, systemPrompt, sessionId) {
    const sdkModel = resolveSdkModel(model, provider);
    const providerCfg = buildProviderConfig(provider);
    const cfg = {
        model: sdkModel,
        sessionId,
        streaming: true,
        onPermissionRequest: approveAll,
        useLoggedInUser: false,
        availableTools: [],
    };
    if (systemPrompt) {
        cfg.systemMessage = {
            mode: 'replace',
            content: systemPrompt,
        };
    }
    if (authToken) {
        cfg.gitHubToken = authToken;
        cfg.githubToken = authToken;
    }
    if (providerCfg) cfg.provider = providerCfg;
    const modelCapabilities = buildModelCapabilities(provider);
    if (modelCapabilities) cfg.modelCapabilities = modelCapabilities;
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

function sessionCacheKey({ sessionId, model, provider }) {
    const providerType = provider?.type || 'github';
    const providerBase = provider?.baseUrl || '';
    return `${sessionId || 'default'}::${providerType}::${providerBase}::${model}`;
}

async function getOrCreateSession({ sessionId, model, authToken, provider, messages }) {
    const cacheKey = sessionCacheKey({ sessionId, model, provider });
    const cached = sessions.get(cacheKey);
    if (cached?.session) return cached.session;

    const { systemPrompt } = splitPromptMessages(messages);
    const session = await client.createSession(buildSessionConfig(model, authToken, provider, systemPrompt, sessionId));
    sessions.set(cacheKey, {
        session,
        lastUsed: Date.now(),
    });
    return session;
}

// ── POST /chat/complete — non-streaming, returns JSON ──────────────────────────

app.post('/chat/complete', async (req, res) => {
    const { model, apiKey, messages, provider, sessionId } = req.body ?? {};

    if (!model) return res.status(400).json({ error: 'Missing model' });
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'Missing messages array' });

    const providerCfg = hasCustomProvider(provider) ? { ...provider, apiKey: provider.apiKey || apiKey } : null;
    const authToken = hasCustomProvider(providerCfg) ? '' : pickString(apiKey);
    if (!authToken && !hasCustomProvider(providerCfg)) {
        return res.status(400).json({
            error: 'Missing GitHub Copilot token. Save a Copilot-enabled GitHub token in Settings for the GitHub Copilot SDK provider.',
        });
    }

    try {
        await ensureClientStarted();
        console.log(`[copilot-proxy] /chat/complete model=${model} sdkModel=${resolveSdkModel(model, providerCfg)} session=${sessionId || 'default'} messages=${messages.length}${providerCfg ? ` byok=${providerCfg.type}` : ''}`);

        const fallbackModels = ['gpt-4.1', 'gpt-4o', 'claude-sonnet-4.5', 'gpt-5'];
        const candidates = providerCfg ? [model] : [model, ...fallbackModels.filter(m => m !== model)];
        let chosenModel = model;
        let session = null;
        let lastError = null;

        for (const candidate of candidates) {
            try {
                session = await getOrCreateSession({ sessionId, model: candidate, authToken, provider: providerCfg, messages });
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
            return res.status(500).json({
                error: `${message}. Tavro maps claude-sonnet-4-5 to claude-sonnet-4-20250514 for Copilot SDK BYOK; rebuild/restart the copilot-sdk container if this error persists.`,
            });
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
    const { model, apiKey, messages, provider, sessionId } = req.body ?? {};

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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const sendDone  = () => { res.write('data: [DONE]\n\n'); res.end(); };

    try {
        await ensureClientStarted();
        console.log(`[copilot-proxy] /chat/stream model=${model} sdkModel=${resolveSdkModel(model, providerCfg)} session=${sessionId || 'default'} messages=${messages.length}${providerCfg ? ` byok=${providerCfg.type}` : ''}`);

        const session = await getOrCreateSession({ sessionId, model, authToken, provider: providerCfg, messages });

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
            sendEvent({
                error: `${message}. Tavro maps claude-sonnet-4-5 to claude-sonnet-4-20250514 for Copilot SDK BYOK; rebuild/restart the copilot-sdk container if this error persists.`,
            });
            res.end();
            return;
        }
        sendEvent({ error: message });
        res.end();
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
            max_tokens: 1024,
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
            max_tokens: 1024,
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
    const { providerType, endpoint, apiKey, bearerToken, body } = req.body ?? {};

    if (!endpoint || !body)     return res.status(400).json({ error: 'Missing endpoint or body' });
    if (!endpoint.startsWith('https://')) return res.status(400).json({ error: 'Only HTTPS endpoints allowed' });

    console.log(`[copilot-byok] /chat/byok/complete type=${providerType} endpoint=${endpoint}`);

    try {
        const upstream = await fetch(endpoint, {
            method:  'POST',
            headers: buildUpstreamHeaders(providerType, apiKey, bearerToken),
            body:    JSON.stringify(body),
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

app.post('/chat/byok/stream', async (req, res) => {
    const { providerType, endpoint, apiKey, bearerToken, body } = req.body ?? {};

    if (!endpoint || !body) { res.status(400).json({ error: 'Missing endpoint or body' }); return; }
    if (!endpoint.startsWith('https://')) { res.status(400).json({ error: 'Only HTTPS endpoints allowed' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const sendDone  = () => { res.write('data: [DONE]\n\n'); res.end(); };

    console.log(`[copilot-byok] /chat/byok/stream type=${providerType} endpoint=${endpoint}`);

    try {
        const upstream = await fetch(endpoint, {
            method:  'POST',
            headers: buildUpstreamHeaders(providerType, apiKey, bearerToken),
            body:    JSON.stringify({ ...body, stream: true }),
        });

        if (!upstream.ok) {
            const err = await upstream.json().catch(() => ({}));
            const msg = err?.error?.message ?? err?.error ?? `Upstream ${upstream.status}`;
            console.error(`[copilot-byok] stream upstream error ${upstream.status}`, { msg });
            sendEvent({ error: msg });
            res.end();
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
        sendEvent({ error: err.message });
        res.end();
    }
});

// ── GET /health ────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.listen(PORT, () => {
    console.log(`[copilot-proxy] listening on port ${PORT}`);
});
