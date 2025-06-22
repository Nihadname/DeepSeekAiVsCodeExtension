const vscode = acquireVsCodeApi();
const userInput = document.getElementById('userInput');
const messagesDiv = document.getElementById('messages');

let currentAIMessageElement = null; // Reference to the AI message div being streamed into
let currentResponseText = ''; // Buffer for the current response
let markdownIt = null; // Will be initialized when markdown-it loads
let isTyping = false; // Track if AI is currently responding

// Initialize markdown-it when the library loads
function initializeMarkdownIt() {
    if (typeof window.markdownit !== 'undefined') {
        markdownIt = window.markdownit({
            html: false,
            linkify: true,
            typographer: true,
            breaks: true
        });
        
        // Add highlight.js plugin if available
        if (typeof window.markdownitHighlightjs !== 'undefined' && window.hljs) {
            markdownIt.use(window.markdownitHighlightjs, {
                hljs: window.hljs,
                inline: true
            });
        }
        
        console.log('Markdown-it initialized successfully');
    } else {
        console.log('Markdown-it not available yet');
    }
}

function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  // Append user message immediately
  appendMessage('You', message, true);

  // Clear any existing streaming element reference and buffer
  currentAIMessageElement = null; 
  currentResponseText = '';
  isTyping = true;
  
  // Show typing indicator
  showTypingIndicator();
  
  vscode.postMessage({ command: 'askDeepSeek', text: message });
  userInput.value = '';
  userInput.focus();
  
  // Disable input while AI is responding
  userInput.disabled = true;
  document.getElementById('sendButton').disabled = true;
}

function appendMessage(sender, text, isUser) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message ' + (isUser ? 'user-message' : 'ai-message');

  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-header';
  headerDiv.textContent = sender;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  if (isUser) {
    // For user messages, just use plain text
    contentDiv.textContent = text;
  } else {
    // For AI messages, we'll handle formatting in the streaming function
    contentDiv.textContent = text;
  }

  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(contentDiv);
  messagesDiv.appendChild(messageDiv);

  // Smooth scroll to the new message
  smoothScrollToBottom();
  
  return messageDiv; // Return the created message element
}

// Function to show typing indicator
function showTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'message ai-message typing-indicator';
  typingDiv.id = 'typing-indicator';
  
  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-header';
  headerDiv.textContent = 'DeepSeek AI';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = `
    <div class="typing-indicator">
      <span>Thinking</span>
      <div class="typing-dots">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  
  typingDiv.appendChild(headerDiv);
  typingDiv.appendChild(contentDiv);
  messagesDiv.appendChild(typingDiv);
  
  smoothScrollToBottom();
}

// Function to hide typing indicator
function hideTypingIndicator() {
  const typingIndicator = document.getElementById('typing-indicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// Function to handle incoming streamed chunks
function handleResponseChunk(chunkText, isFirstChunk) {
    if (isFirstChunk || !currentAIMessageElement) {
        // Hide typing indicator
        hideTypingIndicator();
        
        // If it's the very first chunk or we don't have an active AI message element, create one.
        currentAIMessageElement = appendMessage('DeepSeek AI', '', false);
        currentResponseText = '';
    }
    
    // Add the new chunk to our buffer
    currentResponseText += chunkText;
    
    // Update the content with formatted markdown
    updateMessageContent(currentResponseText);
    
    // Smooth scroll to keep the latest content visible
    smoothScrollToBottom();
}

// Function to update message content with proper markdown formatting
function updateMessageContent(text) {
    if (!currentAIMessageElement) return;
    
    const contentDiv = currentAIMessageElement.querySelector('.message-content');
    if (!contentDiv) return;
    
    if (markdownIt) {
        try {
            // Use markdown-it to parse and format the text
            const html = markdownIt.render(text);
            contentDiv.innerHTML = html;
            
            // Apply syntax highlighting to any code blocks
            if (window.hljs) {
                contentDiv.querySelectorAll('pre code').forEach((block) => {
                    window.hljs.highlightElement(block);
                });
            }
        } catch (error) {
            console.error('Error rendering markdown:', error);
            // Fallback to plain text if markdown rendering fails
            contentDiv.textContent = text;
        }
    } else {
        // Fallback to plain text if markdown-it isn't loaded yet
        contentDiv.textContent = text;
    }
}

// Function to finalize the AI message
function finalizeAIMessage() {
    if (currentAIMessageElement) {
        // Ensure final formatting is applied
        updateMessageContent(currentResponseText);
    }
    currentAIMessageElement = null; // Reset for the next message
    currentResponseText = ''; // Clear the buffer
    isTyping = false;
    
    // Re-enable input
    userInput.disabled = false;
    document.getElementById('sendButton').disabled = false;
    userInput.focus();
}

// Improved smooth scrolling function
function smoothScrollToBottom() {
    const scrollOptions = {
        top: messagesDiv.scrollHeight,
        behavior: 'smooth'
    };
    
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
        messagesDiv.scrollTo(scrollOptions);
    });
}

// Auto-resize textarea
function autoResizeTextarea() {
    const textarea = userInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea on input
userInput.addEventListener('input', autoResizeTextarea);

// Handle paste events for auto-resize
userInput.addEventListener('paste', () => {
    setTimeout(autoResizeTextarea, 0);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.command === 'responseChunk') {
    handleResponseChunk(message.text, message.isFirst);
  } else if (message.command === 'responseComplete') {
    finalizeAIMessage();
  }
});

// Initialize markdown-it when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Try to initialize markdown-it immediately
    initializeMarkdownIt();
    
    // If markdown-it isn't loaded yet, try again multiple times
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryInitialize = () => {
        if (!markdownIt && attempts < maxAttempts) {
            attempts++;
            setTimeout(() => {
                initializeMarkdownIt();
                if (!markdownIt) {
                    tryInitialize();
                }
            }, 200);
        }
    };
    
    tryInitialize();
    
    // Also try when window loads completely
    window.addEventListener('load', () => {
        if (!markdownIt) {
            initializeMarkdownIt();
        }
    });
    
    // Show setup instructions on first load
    if (messagesDiv.children.length === 0) {
        showSetupInstructions();
    }
    
    // Focus on input when page loads
    userInput.focus();
});

// Function to check Ollama status
async function checkOllamaStatus() {
    try {
        const response = await fetch('http://localhost:11434/api/tags', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const data = await response.json();
            const modelExists = data.models?.some((model) => 
                model.name === 'deepseek-r1:8b-llama-distill-q4_K_M'
            );
            
            if (modelExists) {
                updateStatusIndicator('online', 'Ollama: Online');
                return true;
            } else {
                updateStatusIndicator('offline', 'Ollama: Running (Model not installed)');
                return false;
            }
        } else {
            updateStatusIndicator('offline', 'Ollama: Error');
            return false;
        }
    } catch (error) {
        updateStatusIndicator('offline', 'Ollama: Offline');
        return false;
    }
}

// Function to update status indicator
function updateStatusIndicator(status, text) {
    const statusIndicator = document.querySelector('.status-indicator');
    if (statusIndicator) {
        const statusDot = statusIndicator.querySelector('.status-dot');
        const statusText = statusIndicator.querySelector('span:last-child');
        
        if (statusDot) {
            statusDot.className = `status-dot ${status}`;
        }
        if (statusText) {
            statusText.textContent = text;
        }
    }
}

// Function to show setup instructions
function showSetupInstructions() {
    const setupDiv = document.createElement('div');
    setupDiv.className = 'message ai-message setup-message';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    headerDiv.textContent = 'DeepSeek AI';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = `
        <div class="setup-instructions">
            <h3>🚀 Welcome to DeepSeek AI!</h3>
            <p>To get started, you need to set up Ollama:</p>
            
            <h4>1. Install Ollama</h4>
            <p>Download and install from <a href="https://ollama.ai" target="_blank">https://ollama.ai</a></p>
            
            <h4>2. Start Ollama</h4>
            <p>Open terminal and run:</p>
            <pre><code>ollama serve</code></pre>
            
            <h4>3. Pull the Model</h4>
            <p>In another terminal, run:</p>
            <pre><code>ollama pull deepseek-r1:8b-llama-distill-q4_K_M</code></pre>
            
            <h4>4. Start Chatting!</h4>
            <p>Once Ollama is running, you can start asking questions below.</p>
            
            <div class="status-indicator">
                <span class="status-dot offline"></span>
                <span>Ollama: Checking...</span>
                <button onclick="checkOllamaStatus()" class="refresh-btn">🔄 Refresh</button>
            </div>
        </div>
    `;
    
    setupDiv.appendChild(headerDiv);
    setupDiv.appendChild(contentDiv);
    messagesDiv.appendChild(setupDiv);
    
    smoothScrollToBottom();
    
    // Check status after showing instructions
    setTimeout(checkOllamaStatus, 1000);
}