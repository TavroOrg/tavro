import express from 'express';
import cors from 'cors';
import { CopilotClient, approveAll } from '@github/copilot-sdk';

const PORT = Number(process.env.PORT || 4000);
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

let client;
let clientStarted = false;

function getAuthToken(apiKey) {
    return pickString(apiKey);
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
            case 'system': return `System: ${content}`;
            case 'assistant': return `Assistant: ${content}`;
            case 'user': return `User: ${content}`;
            case 'tool': return `Tool ${message.name || message.tool_call_id || ''}: ${content}`;
            default: return `${message.role}: ${content}`;
        }
    }).join('\n');
}

function pickString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
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

app.post('/chat/complete', async (req, res) => {
    const { model, apiKey, messages } = req.body ?? {};
    if (!model) {
        return res.status(400).json({ error: 'Missing model' });
    }
    if (!Array.isArray(messages)) {
        return res.status(400).json({ error: 'Missing messages array' });
    }
    const authToken = getAuthToken(apiKey);
    if (!authToken) {
        return res.status(400).json({
            error: 'Missing GitHub Copilot token. Save a Copilot-enabled GitHub token in Settings for the GitHub Copilot SDK provider.',
        });
    }

    try {
        await ensureClientStarted();
        console.log(`Copilot SDK proxy request: model=${model} messages=${Array.isArray(messages) ? messages.length : 0}`);

        const fallbackModels = ['gpt-4.1', 'gpt-4o', 'claude-sonnet-4.5', 'gpt-5'];
        const modelCandidates = [model, ...fallbackModels.filter(m => m !== model)];
        let chosenModel = model;
        let session;
        let lastCreateError = null;

        for (const candidate of modelCandidates) {
            try {
                session = await client.createSession({
                    model: candidate,
                    streaming: true,
                    githubToken: authToken,
                    gitHubToken: authToken,
                    useLoggedInUser: false,
                    onPermissionRequest: approveAll,
                });
                chosenModel = candidate;
                if (candidate !== model) {
                    console.warn(`Copilot SDK proxy falling back from requested model ${model} to available model ${candidate}`);
                }
                break;
            } catch (err) {
                lastCreateError = err;
                const message = err?.message ?? String(err);
                if (!message.includes('Model') || !message.includes('not available')) {
                    throw err;
                }
            }
        }

        if (!session) {
            throw lastCreateError || new Error('Failed to create Copilot session.');
        }

        try {
            const prompt = renderChatPrompt(messages);
            console.log('Copilot SDK proxy sending prompt', { model: chosenModel, promptLength: prompt.length });

            let streamedContent = '';
            const unsubscribeDelta = session.on('assistant.message_delta', (event) => {
                streamedContent += extractEventContent(event);
            });
            let event;
            try {
                event = await session.sendAndWait({ prompt }, 120000);
            } finally {
                if (typeof unsubscribeDelta === 'function') {
                    unsubscribeDelta();
                }
            }

            console.log('Copilot SDK proxy session event', {
                type: event?.type,
                data: event?.data ? {
                    keys: Object.keys(event.data),
                    contentLength: extractEventContent(event).length,
                    streamedContentLength: streamedContent.length,
                } : undefined,
            });

            const content = (extractEventContent(event) || streamedContent).trim();
            if (!content) {
                console.error('Copilot SDK proxy returned empty assistant content', {
                    model,
                    chosenModel,
                    messageCount: Array.isArray(messages) ? messages.length : undefined,
                    eventType: event?.type,
                    eventDataKeys: event?.data ? Object.keys(event.data) : [],
                });
                return res.status(500).json({
                    error: 'Copilot SDK proxy returned no assistant content. Check the server logs for event details.',
                    eventType: event?.type,
                    eventDataKeys: event?.data ? Object.keys(event.data) : [],
                });
            }
            return res.json({ type: 'text', content, model: chosenModel });
        } finally {
            try {
                await session.disconnect();
            } catch (ignore) {
                // best-effort cleanup
            }
        }
    } catch (err) {
        const message = err?.message ?? String(err);
        console.error('Copilot SDK proxy request failed', { message, error: err });
        const status = isAuthError(message) ? 401 : 500;
        const authHelp = status === 401
            ? 'GitHub Copilot authentication failed. Save a Copilot-enabled GitHub token in Settings for the GitHub Copilot SDK provider. Classic ghp_ PATs are not supported by the Copilot SDK.'
            : undefined;
        return res.status(status).json({ error: message, authHelp });
    }
});

app.get('/health', (req, res) => {
    res.status(200).send('ok');
});

app.listen(PORT, () => {
    console.log(`Copilot SDK proxy server listening on port ${PORT}`);
});
