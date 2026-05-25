#!/usr/bin/env node
/**
 * Compares get_agent_card vs get_agent_catalog for TAVAC0004677.
 * Validates that the field names/nesting match the AgentData TypeScript type.
 */
const https = require('https');
const AGENT_ID = process.argv[2] || 'TAVAC0004677';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2Nvbm5lY3QtbWNwLnRhdnJvLmFpL2dpdGh1YiIsImF1ZCI6Imh0dHBzOi8vY29ubmVjdC1tY3AudGF2cm8uYWkvZ2l0aHViL21jcCIsImNsaWVudF9pZCI6ImExYTM2MDAzLTcxOTQtNGFlMi1hNWE3LTIyOWM0ZjAyODQxZSIsInNjb3BlIjoiIiwiZXhwIjoxODAzOTEyMzQ3LCJpYXQiOjE3NzIzNzYzNDcsImp0aSI6IkxYVjBDZ3VoSlYtOElVdG5zQVZVQ1gzdHZ0bnZteEowdFpVajZDR0s1UmsifQ.ZR333qi-ba6pR1MJL7Kshi08R4Tmis39PgqBNVe76LE';

let sessionId = '';

function ssePost(body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const opts = {
            hostname: 'connect-mcp.tavro.ai',
            path: '/github/mcp',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(data),
                ...(sessionId ? { 'mcp-session-id': sessionId } : {})
            }
        };
        const req = https.request(opts, res => {
            if (res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
            let buf = '';
            res.on('data', c => { buf += c; });
            res.on('end', () => {
                // Find the last complete data: line
                const lines = buf.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try { resolve(JSON.parse(line.slice(6))); return; } catch { }
                    }
                }
                try { resolve(JSON.parse(buf)); } catch { resolve(null); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function printSection(title, data) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(60));
    console.log(JSON.stringify(data, null, 2));
}

async function main() {
    // Initialize session
    await ssePost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
    await ssePost({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // List tools
    const toolsRes = await ssePost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = toolsRes?.result?.tools || [];
    const toolNames = tools.map(t => t.name);
    console.log('Available tools:', toolNames.join(', '));

    // Show get_agent_card schema if it exists
    const cardTool = tools.find(t => t.name === 'get_agent_card');
    if (cardTool) {
        printSection('get_agent_card input schema', cardTool.inputSchema);
    } else {
        console.log('\n❌ get_agent_card tool NOT available! Using catalog only.');
    }

    // Call get_agent_card
    if (cardTool) {
        console.log(`\n📡 Calling get_agent_card with agent_id=${AGENT_ID}...`);
        const res = await ssePost({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_agent_card', arguments: { agent_id: AGENT_ID } } });
        if (res?.result?.content?.[0]?.text) {
            const parsed = JSON.parse(res.result.content[0].text);
            printSection('get_agent_card → top-level keys', Object.keys(parsed));
            printSection('get_agent_card → application', parsed.application);
            printSection('get_agent_card → business_process', parsed.business_process);
            printSection('get_agent_card → identification', parsed.identification);
            // Full nesting check
            if (parsed.agent_card) {
                console.log('\n⚠️  Response is NESTED under agent_card key, not flat!');
                const inner = Array.isArray(parsed.agent_card) ? parsed.agent_card[0] : parsed.agent_card;
                printSection('get_agent_card → agent_card[0].application', inner?.application);
            }
        } else {
            console.log('get_agent_card errored:', JSON.stringify(res?.result || res?.error));
        }
    }

    // Catalog entry for comparison
    console.log(`\n📡 Fetching catalog (first 50) to find ${AGENT_ID}...`);
    const catRes = await ssePost({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_agent_catalog', arguments: { start_record: 1, max_records: 50, record_range: '1-50' } } });
    if (catRes?.result?.content?.[0]?.text) {
        const catParsed = JSON.parse(catRes.result.content[0].text);
        const agents = catParsed.agent_card || (Array.isArray(catParsed) ? catParsed : []);
        const target = agents.find(a => a.identification?.agent_id === AGENT_ID);
        if (target) {
            printSection(`Catalog entry for ${AGENT_ID} → application`, target.application);
            printSection(`Catalog entry for ${AGENT_ID} → identification`, target.identification);
        } else {
            console.log(`\n${AGENT_ID} not found in first 50 records`);
        }
    }
}

main().catch(console.error);
