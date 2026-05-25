#!/usr/bin/env node
// Probes get_agent_risk_summary schema + sample response for TAVAC0004677
const https = require('https');
const AGENT_ID = process.argv[2] || 'TAVAC0004677';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2Nvbm5lY3QtbWNwLnRhdnJvLmFpL2dpdGh1YiIsImF1ZCI6Imh0dHBzOi8vY29ubmVjdC1tY3AudGF2cm8uYWkvZ2l0aHViL21jcCIsImNsaWVudF9pZCI6ImExYTM2MDAzLTcxOTQtNGFlMi1hNWE3LTIyOWM0ZjAyODQxZSIsInNjb3BlIjoiIiwiZXhwIjoxODAzOTEyMzQ3LCJpYXQiOjE3NzIzNzYzNDcsImp0aSI6IkxYVjBDZ3VoSlYtOElVdG5zQVZVQ1gzdHZ0bnZteEowdFpVajZDR0s1UmsifQ.ZR333qi-ba6pR1MJL7Kshi08R4Tmis39PgqBNVe76LE';
let sessionId = '';

function ssePost(body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: 'connect-mcp.tavro.ai', path: '/github/mcp', method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data),
                ...(sessionId ? { 'mcp-session-id': sessionId } : {})
            }
        }, res => {
            if (res.headers['mcp-session-id']) sessionId = res.headers['mcp-session-id'];
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                for (const line of buf.split('\n')) {
                    if (line.startsWith('data: ')) { try { resolve(JSON.parse(line.slice(6))); return; } catch { } }
                }
                try { resolve(JSON.parse(buf)); } catch { resolve(null); }
            });
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

async function main() {
    await ssePost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
    await ssePost({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // Get schema
    const toolsRes = await ssePost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tool = toolsRes?.result?.tools?.find(t => t.name === 'get_agent_risk_summary');
    console.log('=== get_agent_risk_summary schema ===');
    console.log(JSON.stringify(tool?.inputSchema, null, 2));

    // Call the tool
    console.log(`\n=== Calling with agent_id=${AGENT_ID} ===`);
    const res = await ssePost({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_agent_risk_summary', arguments: { agent_id: AGENT_ID } } });
    const text = res?.result?.content?.[0]?.text;
    if (text) {
        const parsed = JSON.parse(text);
        console.log('\nTop-level keys:', Object.keys(parsed));
        console.log('\nFull response:');
        console.log(JSON.stringify(parsed, null, 2));
    } else {
        console.log('Error/empty:', JSON.stringify(res));
    }
}
main().catch(console.error);
