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
    contentDiv.textContent = text;
    
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