const vscode = acquireVsCodeApi();
const userInput = document.getElementById('userInput');

function sendMessage() {
    const message = userInput.value.trim();
    if (message) {
        appendMessage('You', message, true);
        vscode.postMessage({ command: 'askDeepSeek', text: message });
        userInput.value = '';
    }
}

function appendMessage(sender, text, isUser) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (isUser ? 'user-message' : 'ai-message');

    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    headerDiv.textContent = sender;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // ✅ Fix: Detect AI-generated code blocks and properly format them
    if (text.includes("```")) {
        // Extract code block
        const codeMatch = text.match(/```(\w+)?\n([\s\S]+?)```/);
        if (codeMatch) {
            const language = codeMatch[1] || "plaintext"; // Extract language or default to plaintext
            const codeContent = codeMatch[2];

            // Create <pre><code> block
            const pre = document.createElement('pre');
            const code = document.createElement('code');

            code.className = "language-" + language;
            code.textContent = codeContent;

            pre.appendChild(code);
            contentDiv.appendChild(pre);

            // ✅ Fix: Apply syntax highlighting after appending the block
            setTimeout(() => {
                hljs.highlightElement(code);
            }, 10);
        } else {
            // If regex fails, fallback to normal text
            contentDiv.textContent = text;
        }
    } else {
        contentDiv.textContent = text;
    }

    messageDiv.appendChild(headerDiv);
    messageDiv.appendChild(contentDiv);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}





userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'response') {
        appendMessage('DeepSeek AI', message.text, false);
    }
});
