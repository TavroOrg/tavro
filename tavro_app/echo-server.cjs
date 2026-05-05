const http = require('http');

const server = http.createServer((req, res) => {
    console.log(`[Echo Server] Received ${req.method} request to ${req.url}`);
    console.log('[Echo Server] Headers:', req.headers);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        url: req.url,
        method: req.method,
        headers: req.headers
    }));
});

server.listen(8088, () => {
    console.log('Echo server listening on port 8088');
});
