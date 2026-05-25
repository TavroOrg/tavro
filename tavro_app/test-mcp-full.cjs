#!/usr/bin/env node
/**
 * Full Tavro MCP OAuth + SSE Connection Tester
 * Run: node test-mcp-full.cjs
 *
 * Step 1: Registers a client and prints the authorization URL
 * Step 2: You paste the code from the redirect
 * Step 3: Exchanges code for token
 * Step 4: Tests the SSE connection with that token
 */

const https = require('https');
const http = require('http');
const readline = require('readline');
const crypto = require('crypto');

const MCP_BASE = 'https://connect-mcp.tavro.ai';
const REDIRECT_URI = 'http://localhost:5173/auth/callback';

// — PKCE helpers —
function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateVerifier() {
    return base64url(crypto.randomBytes(32));
}
async function generateChallenge(verifier) {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return base64url(hash);
}

// — HTTP helpers —
function post(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Length': Buffer.byteLength(data),
                ...headers
            }
        };
        const req = (parsed.protocol === 'https:' ? https : http).request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                console.log(`\n[HTTP ${res.statusCode}] POST ${url}`);
                console.log('Response:', raw);
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// — SSE streaming test —
function testSSE(url, token) {
    return new Promise((resolve) => {
        console.log(`\n🔌 Testing SSE connection to: ${url}`);
        console.log(`🔑 Using token: ${token.substring(0, 20)}...`);

        const parsed = new URL(url);
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        };

        const req = (parsed.protocol === 'https:' ? https : http).request(opts, res => {
            console.log(`\n[SSE Response] HTTP ${res.statusCode}`);
            console.log('Headers:', JSON.stringify(res.headers, null, 2));

            if (res.statusCode !== 200) {
                let raw = '';
                res.on('data', c => raw += c);
                res.on('end', () => {
                    console.log('Error body:', raw);
                    resolve({ success: false, status: res.statusCode, body: raw });
                });
                return;
            }

            console.log('\n✅ SSE stream opened! Waiting for first event (5 seconds)...');
            let events = [];
            let timeout = setTimeout(() => {
                req.destroy();
                console.log('\nReceived events:', events);
                resolve({ success: true, events });
            }, 5000);

            res.on('data', chunk => {
                const text = chunk.toString();
                console.log('Event:', text);
                events.push(text);
                // Got the endpoint event, that's enough
                if (text.includes('endpoint')) {
                    clearTimeout(timeout);
                    req.destroy();
                    resolve({ success: true, events });
                }
            });
        });

        req.on('error', err => {
            console.log('SSE connection error:', err.message);
            resolve({ success: false, error: err.message });
        });
        req.end();
    });
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log('=== Tavro MCP Full Auth + Connection Test ===\n');

    // Step 1: Register
    console.log('📋 Step 1: Dynamic Client Registration...');
    const regResult = await post(
        `${MCP_BASE}/github/register`,
        { client_name: 'test-mcp-debug', redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' },
        { 'Content-Type': 'application/json' }
    );

    if (!regResult.body.client_id) {
        console.error('❌ Registration failed!');
        rl.close();
        return;
    }
    const clientId = regResult.body.client_id;
    console.log(`\n✅ Registered! client_id: ${clientId}`);

    // Step 2: PKCE + Auth URL
    console.log('\n🔐 Step 2: Generating PKCE...');
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);
    console.log(`verifier: ${verifier}`);
    console.log(`challenge: ${challenge}`);

    const authUrl = new URL(`${MCP_BASE}/github/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log('\n🌐 Step 3: Open this URL in your browser:');
    console.log('\n' + authUrl.toString() + '\n');
    console.log('After authorizing, you will be redirected to http://localhost:5173/auth/callback?code=XXXX');
    console.log('Copy just the CODE value from the URL.');

    const code = await ask('\nPaste the authorization code here: ');

    // Step 4: Token Exchange
    console.log('\n🔄 Step 4: Exchanging code for token...');
    const tokenResult = await post(
        `${MCP_BASE}/github/token`,
        new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code: code.trim(),
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier
        }).toString(),
        {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        }
    );

    if (!tokenResult.body.access_token) {
        console.error('\n❌ Token exchange failed!');
        rl.close();
        return;
    }

    const token = tokenResult.body.access_token;
    const tokenType = tokenResult.body.token_type;
    console.log(`\n✅ Got token! type=${tokenType}`);
    console.log(`Token preview: ${token.substring(0, 30)}...`);
    console.log(`Full token (for localStorage): ${token}`);

    // Step 5: Test direct HTTPS SSE
    console.log('\n🔌 Step 5: Testing SSE connection DIRECTLY (no proxy)...');
    const directResult = await testSSE(`${MCP_BASE}/github/mcp`, token);

    if (!directResult.success) {
        console.log('\n❌ Direct SSE failed. Checking if proxy works differently...');

        // Also test via localhost proxy if dev server is running
        console.log('\n🔌 Testing SSE via Vite Proxy (localhost:5173)...');
        const proxyResult = await testSSE('http://localhost:5173/api/tavro-mcp/github/mcp', token);
        if (proxyResult.success) {
            console.log('\n✅ Proxy SSE works but direct does not — CORS issue!');
        } else {
            console.log('\n❌ Both failed. Token or endpoint issue.');
        }
    } else {
        console.log('\n✅ SUCCESS! The full MCP auth + SSE connection works!');
        console.log('\nTo fix the app, open browser console at http://localhost:5173 and run:');
        console.log(`localStorage.setItem('tavro_github_token', '${token}');`);
        console.log(`localStorage.setItem('tavro_auth', 'true');`);
    }

    rl.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
