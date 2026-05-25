#!/usr/bin/env node
/**
 * Tests get_agent_catalog tool via Streamable HTTP transport (Node.js)
 */
const https = require('https');
const http = require('http');

const TOKEN = process.env.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2Nvbm5lY3QtbWNwLnRhdnJvLmFpL2dpdGh1YiIsImF1ZCI6Imh0dHBzOi8vY29ubmVjdC1tY3AudGF2cm8uYWkvZ2l0aHViL21jcCIsImNsaWVudF9pZCI6ImExYTM2MDAzLTcxOTQtNGFlMi1hNWE3LTIyOWM0ZjAyODQxZSIsInNjb3BlIjoiIiwiZXhwIjoxODAzOTEyMzQ3LCJpYXQiOjE3NzIzNzYzNDcsImp0aSI6IkxYVjBDZ3VoSlYtOElVdG5zQVZVQ1gzdHZ0bnZteEowdFpVajZDR0s1UmsifQ.ZR333qi-ba6pR1MJL7Kshi08R4Tmis39PgqBNVe76LE';
const BASE = 'https://connect-mcp.tavro.ai';
const PATH = '/github/mcp';

function requestJSON(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = body ? JSON.stringify(body) : undefined;
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': `Bearer ${TOKEN}`,
                ...headers,
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        };

        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                console.log(`\n[${method} ${res.statusCode}] ${url}`);
                console.log('Response headers:', JSON.stringify({
                    'mcp-session-id': res.headers['mcp-session-id'],
                    'content-type': res.headers['content-type']
                }));
                console.log('Body:', raw.substring(0, 2000));
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) });
                } catch {
                    resolve({ status: res.statusCode, headers: res.headers, body: raw });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function main() {
    console.log('=== Testing get_agent_catalog via Streamable HTTP ===\n');

    // Step 1: Initialize session with initialize request
    console.log('📡 Step 1: Sending MCP initialize request...');
    const initRes = await requestJSON('POST', `${BASE}${PATH}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' }
        }
    });

    const sessionId = initRes.headers['mcp-session-id'];
    if (!sessionId) {
        console.error('❌ No session ID returned from initialize!');
        return;
    }
    console.log(`✅ Session established: ${sessionId}`);

    // Step 2: Send initialized notification
    console.log('\n📡 Step 2: Sending initialized notification...');
    await requestJSON('POST', `${BASE}${PATH}`, {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
    }, { 'mcp-session-id': sessionId });

    // Step 3: List tools to confirm what arguments get_agent_catalog takes
    console.log('\n📡 Step 3: Listing available tools...');
    const toolsRes = await requestJSON('POST', `${BASE}${PATH}`, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    }, { 'mcp-session-id': sessionId });

    const catalogTool = toolsRes.body?.result?.tools?.find(t => t.name === 'get_agent_catalog');
    if (catalogTool) {
        console.log('\n✅ Found get_agent_catalog tool:');
        console.log(JSON.stringify(catalogTool, null, 2));
    } else {
        console.log('Available tools:', JSON.stringify(toolsRes.body?.result?.tools?.map(t => t.name)));
    }

    // Step 4: Call get_agent_catalog with limit=30
    console.log('\n📡 Step 4: Calling get_agent_catalog with limit=30...');
    const catalogRes = await requestJSON('POST', `${BASE}${PATH}`, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'get_agent_catalog',
            arguments: { limit: 30 }
        }
    }, { 'mcp-session-id': sessionId });

    if (catalogRes.body?.result) {
        const content = catalogRes.body.result.content;
        console.log('\n✅ get_agent_catalog response content type:', content?.[0]?.type);
        if (content?.[0]?.text) {
            try {
                const data = JSON.parse(content[0].text);
                console.log(`Got ${Array.isArray(data) ? data.length : 'non-array'} agents`);
                console.log('First agent sample:', JSON.stringify(data[0], null, 2).substring(0, 500));
            } catch {
                console.log('Raw text:', content[0].text.substring(0, 500));
            }
        }
    } else if (catalogRes.body?.error) {
        console.log('\n❌ Tool call error:', JSON.stringify(catalogRes.body.error));
    }

    // Step 5: Also test with no limit argument
    console.log('\n📡 Step 5: Calling get_agent_catalog with no arguments...');
    const catalogRes2 = await requestJSON('POST', `${BASE}${PATH}`, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
            name: 'get_agent_catalog',
            arguments: {}
        }
    }, { 'mcp-session-id': sessionId });

    if (catalogRes2.body?.result?.content?.[0]?.text) {
        try {
            const data = JSON.parse(catalogRes2.body.result.content[0].text);
            console.log(`No-limit result: ${Array.isArray(data) ? data.length : 'non-array'} agents`);
        } catch {
            console.log('No-limit raw:', catalogRes2.body.result.content[0].text?.substring(0, 200));
        }
    } else if (catalogRes2.body?.error) {
        console.log('No-limit error:', JSON.stringify(catalogRes2.body.error));
    }
}

main().catch(console.error);
