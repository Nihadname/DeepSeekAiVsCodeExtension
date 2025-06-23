const http = require('http');

const data = JSON.stringify({
    model: 'qwen2.5-coder:7b',
    prompt: 'console.log("Hello World")',
    stream: false
});

const req = http.request({
    hostname: 'localhost',
    port: 11434,
    path: '/api/generate',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
}, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('✅ Success:', body);
    });
});

req.on('error', (error) => {
    console.error('❌ Request Error:', error);
});

req.write(data);
req.end();