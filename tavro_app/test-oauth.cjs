const crypto = require('crypto');

async function testOAuth() {
    console.log("1. Registering client...");
    const regRes = await fetch("https://connect-mcp.tavro.ai/github/register", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_name: 'Test Node Client',
            redirect_uris: ['http://localhost:9000/auth/callback'],
            token_endpoint_auth_method: 'none'
        })
    });
    const regData = await regRes.json();
    const clientId = regData.client_id;
    console.log("Client ID:", clientId);

    // PKCE
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    console.log("2. Get Authorization Code manually via browser or device flow...");
    const authUrl = `https://connect-mcp.tavro.ai/github/authorize?response_type=code&client_id=${clientId}&redirect_uri=http://localhost:9000/auth/callback&code_challenge=${challenge}&code_challenge_method=S256`;
    console.log("Please open this URL in your browser:\n" + authUrl);
    console.log("After redirect, paste the 'code' query parameter here:");

    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });

    readline.question('Code: ', async (code) => {
        readline.close();
        console.log("3. Exchanging code for token...");
        const tokenRes = await fetch('https://connect-mcp.tavro.ai/github/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                code: code.trim(),
                redirect_uri: 'http://localhost:9000/auth/callback',
                code_verifier: verifier
            }).toString()
        });

        const tokenBody = await tokenRes.text();
        console.log("Token Response:", tokenBody);

        try {
            const tokenData = JSON.parse(tokenBody);
            if (tokenData.access_token) {
                console.log("\n4. Testing SSE Endpoint with Token...");
                const sseRes = await fetch(`https://connect-mcp.tavro.ai/github/mcp?access_token=${tokenData.access_token}`, {
                    headers: {
                        'Authorization': `Bearer ${tokenData.access_token}`
                    }
                });
                console.log("SSE Status:", sseRes.status);
                const sseBody = await sseRes.text();
                console.log("SSE Body:", sseBody);
            }
        } catch (e) {
            console.error("Failed to parse token", e);
        }
    });
}
testOAuth();
