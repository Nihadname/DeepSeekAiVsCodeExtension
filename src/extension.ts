import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Qdrant configuration
const QDRANT_URL = 'http://localhost:6333';
const COLLECTION_NAME = 'chat_memory';

// Session management
let currentSessionId = uuidv4();
let currentUserId = 'default_user';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "deepseekaiextension" is now active!');

    // Initialize Qdrant collection
    initializeQdrantCollection();

    // Register the webview view provider
    const provider = new DeepSeekViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('deepseekView', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register command to focus the view
    let disposable = vscode.commands.registerCommand('deepseekaiextension.focusView', () => {
        vscode.commands.executeCommand('deepseekView.focus');
    });

    context.subscriptions.push(disposable);

    // Register command to start new session
    let newSessionDisposable = vscode.commands.registerCommand('deepseekaiextension.newSession', () => {
        currentSessionId = uuidv4();
        vscode.window.showInformationMessage(`New session started: ${currentSessionId.substring(0, 8)}`);
    });

    context.subscriptions.push(newSessionDisposable);

    // Register command to set user ID
    let setUserIdDisposable = vscode.commands.registerCommand('deepseekaiextension.setUserId', async () => {
        const userId = await vscode.window.showInputBox({
            prompt: 'Enter User ID',
            value: currentUserId,
            placeHolder: 'Enter a unique user identifier'
        });
        
        if (userId) {
            currentUserId = userId;
            vscode.window.showInformationMessage(`User ID set to: ${currentUserId}`);
        }
    });

    context.subscriptions.push(setUserIdDisposable);

    // Register command to view session info
    let sessionInfoDisposable = vscode.commands.registerCommand('deepseekaiextension.sessionInfo', () => {
        vscode.window.showInformationMessage(
            `Current Session: ${currentSessionId.substring(0, 8)}\nUser ID: ${currentUserId}`
        );
    });

    context.subscriptions.push(sessionInfoDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

/**
 * Initialize Qdrant collection for chat memory
 */
async function initializeQdrantCollection(): Promise<void> {
    try {
        // Check if collection exists
        const collectionResponse = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
        
        if (collectionResponse.status === 404) {
            // Create collection if it doesn't exist
            const createResponse = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vectors: {
                        size: 768,
                        distance: 'Cosine'
                    }
                })
            });
            
            if (createResponse.ok) {
                console.log('Qdrant collection created successfully');
            } else {
                console.error('Failed to create Qdrant collection');
            }
        } else if (collectionResponse.ok) {
            console.log('Qdrant collection already exists');
        }
    } catch (error) {
        console.error('Error initializing Qdrant collection:', error);
    }
}

/**
 * Get embeddings for text using Ollama
 */
async function getEmbedding(text: string): Promise<number[]> {
    try {
        const res = await fetch('http://localhost:11434/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nomic-embed-text',
                prompt: text
            })
            // No signal/timeout - let it run as long as needed
        });

        if (!res.ok) {
            throw new Error(`Embedding request failed: ${res.status}`);
        }

        const json = await res.json();
        return json.embedding;
    } catch (error) {
        console.error('Error getting embedding:', error);
        throw error; // Re-throw to let caller handle it
    }
}

/**
 * Store chat memory in Qdrant
 */
async function storeChatMemory(text: string, response: string, userId: string, sessionId: string): Promise<void> {
    try {
        // Get embedding for the user input
        const embedding = await getEmbedding(text);
        
        // Store in Qdrant
        const pointId = uuidv4();
        const timestamp = Date.now();
        
        const upsertResponse = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                points: [{
                    id: pointId,
                    vector: embedding,
                    payload: {
                        text: text,
                        response: response,
                        userId: userId,
                        sessionId: sessionId,
                        timestamp: timestamp,
                        type: 'chat_memory'
                    }
                }]
            })
        });

        if (!upsertResponse.ok) {
            console.error('Failed to store chat memory in Qdrant');
        } else {
            console.log('Chat memory stored successfully');
        }
    } catch (error) {
        console.error('Error storing chat memory:', error);
    }
}

/**
 * Search similar chat memories
 */
async function searchSimilarChats(text: string, userId: string, limit: number = 5): Promise<any[]> {
    try {
        console.log(`🔍 Searching for similar chats for user: ${userId}, text: "${text.substring(0, 50)}..."`);
        
        const embedding = await getEmbedding(text);
        console.log(`✅ Got embedding with ${embedding.length} dimensions`);
        
        const searchResponse = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vector: embedding,
                limit: limit * 2, // Get more results to filter
                filter: {
                    must: [
                        { key: 'userId', match: { value: userId } },
                        { key: 'type', match: { value: 'chat_memory' } }
                    ]
                },
                with_payload: true,
                with_vectors: false
            })
        });

        if (!searchResponse.ok) {
            console.error('❌ Failed to search chat memories:', searchResponse.status, searchResponse.statusText);
            return [];
        }

        const result = await searchResponse.json();
        const points = result.result || [];
        console.log(`📊 Found ${points.length} raw points from Qdrant`);
        
        // Log the first point structure for debugging
        if (points.length > 0) {
            console.log(`🔍 First point structure:`, JSON.stringify(points[0], null, 2));
        }
        
        // Filter by similarity score and validate structure
        const SIMILARITY_THRESHOLD = 0.3; // Only include results with similarity > 0.3
        const validPoints = points
            .filter((point: any) => {
                // Check similarity score
                if (point.score < SIMILARITY_THRESHOLD) {
                    console.log(`⚠️ Point below similarity threshold (${point.score}):`, point.id);
                    return false;
                }
                
                // Validate structure
                const isValid = point && 
                       point.payload && 
                       point.payload.text && 
                       point.payload.response &&
                       point.payload.userId === userId &&
                       point.payload.type === 'chat_memory';
                
                if (!isValid) {
                    console.log(`⚠️ Invalid point structure:`, JSON.stringify(point, null, 2));
                }
                
                return isValid;
            })
            .sort((a: any, b: any) => {
                // Sort by similarity score (highest first)
                return b.score - a.score;
            })
            .slice(0, limit); // Take top N results
        
        console.log(`✅ Found ${validPoints.length} valid similar chats (threshold: ${SIMILARITY_THRESHOLD})`);
        
        // Log the selected points
        validPoints.forEach((point: any, index: number) => {
            console.log(`📝 Selected ${index + 1}: Score ${point.score.toFixed(3)}, Text: "${point.payload.text.substring(0, 50)}..."`);
        });
        
        return validPoints;
    } catch (error) {
        console.error('❌ Error searching chat memories:', error);
        // Return empty array instead of throwing - this makes the feature optional
        return [];
    }
}

/**
 * Manages the DeepSeek AI Webview View in the sidebar
 */
class DeepSeekViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'deepseekView';
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'askDeepSeek') {
                const userInput = message.text;
                await this.streamDeepSeekResponse(userInput);
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js');
        const styleUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css');
        const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.html');

        const scriptSrc = webview.asWebviewUri(scriptUri);
        const styleSrc = webview.asWebviewUri(styleUri);

        const htmlContent = fs.readFileSync(htmlUri.fsPath, 'utf8');
        
        return htmlContent
            .replace('${scriptUri}', scriptSrc.toString())
            .replace('${styleUri}', styleSrc.toString());
    }
    
    // --- STREAMING METHOD FOR DEEPSEEK ---
    private async streamDeepSeekResponse(input: string): Promise<void> {
        if (!this._view) return;

        // Search for similar previous conversations
        let similarChats: any[] = [];
        try {
            similarChats = await searchSimilarChats(input, currentUserId, 3);
        } catch (error) {
            console.error('Error searching similar chats:', error);
            // Continue without context if search fails
        }
        
        let contextPrompt = '';
        
        if (similarChats.length > 0) {
            console.log(`🧠 Building context from ${similarChats.length} similar chats`);
            contextPrompt = '\n\n**Previous Related Conversations:**\n';
            similarChats.forEach((chat, index) => {
                // Add validation to ensure payload and text exist
                if (chat.payload && chat.payload.text && chat.payload.response) {
                    console.log(`📝 Adding context ${index + 1}: Q: "${chat.payload.text.substring(0, 30)}..."`);
                    
                    // Format the context more professionally
                    const question = chat.payload.text.trim();
                    const answer = chat.payload.response.trim();
                    
                    contextPrompt += `**Q${index + 1}:** ${question}\n`;
                    contextPrompt += `**A${index + 1}:** ${answer}\n\n`;
                }
            });
            if (contextPrompt !== '\n\n**Previous Related Conversations:**\n') {
                contextPrompt += '**Current Question:** Please provide a comprehensive answer based on the context above and any additional relevant information.\n\n';
                console.log(`✅ Context built successfully: ${contextPrompt.length} characters`);
            } else {
                contextPrompt = ''; // Reset if no valid conversations found
                console.log(`⚠️ No valid conversations found, resetting context`);
            }
        } else {
            console.log(`ℹ️ No similar chats found, proceeding without context`);
        }

        // First check if Ollama is running and the model is available
        try {
            const healthCheck = await fetch('http://localhost:11434/api/tags', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: AbortSignal.timeout(15000) // 15 second timeout for health check
            });

            if (!healthCheck.ok) {
                this._view.webview.postMessage({ 
                    command: 'responseChunk', 
                    text: '❌ **Ollama is running but not responding properly**\n\nPlease check if the DeepSeek model is installed.',
                    isFirst: true
                });
                this._view.webview.postMessage({ command: 'responseComplete' });
                return;
            }

            // Check if the specific model is available
            const modelData = await healthCheck.json();
            const modelExists = modelData.models?.some((model: any) => 
                model.name === 'deepseek-coder:6.7b'
            );

            if (!modelExists) {
                this._view.webview.postMessage({ 
                    command: 'responseChunk', 
                    text: '❌ **Model not found!**\n\nThe DeepSeek model is not installed.\n\n**To install it, run:**\n```bash\nollama pull deepseek-coder:6.7b\n```\n\nThis may take a few minutes depending on your internet connection.',
                    isFirst: true
                });
                this._view.webview.postMessage({ command: 'responseComplete' });
                return;
            }

        } catch (error) {
            console.error('Ollama health check failed:', error);
            
            let errorMessage = '❌ **Ollama Connection Error**\n\nCould not connect to Ollama. Please ensure it is running and accessible at `http://localhost:11434`.';

            if (error instanceof Error && error.cause) {
                const cause = String(error.cause);
                if (cause.includes('ECONNREFUSED')) {
                     errorMessage = '❌ **Connection Refused**\n\nOllama appears to be running but refused the connection. Please check your Ollama server configuration.';
                } else if (cause.includes('Timeout')) {
                    errorMessage = '❌ **Connection Timed Out**\n\nThe connection to Ollama timed out. This could mean:\n- Ollama is not running.\n- It is starting up and not yet ready.\n- A firewall is blocking the connection.';
                }
            } else {
                 errorMessage = '❌ **Ollama is not running!**\n\nTo use DeepSeek AI:\n\n1. **Install Ollama** from https://ollama.ai\n2. **Start Ollama** (e.g., run `ollama serve` in a terminal)\n3. **Pull the model**: `ollama pull deepseek-coder:6.7b`\n4. **Try again after starting Ollama.**';
            }
            
            this._view.webview.postMessage({ 
                command: 'responseChunk', 
                text: errorMessage,
                isFirst: true
            });
            this._view.webview.postMessage({ command: 'responseComplete' });
            return;
        }

        let fullResponse = '';
        
        try {
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'deepseek-coder:6.7b',
                    prompt: contextPrompt + input,
                    stream: true,
                    options: {
                        temperature: 0.7,
                        top_p: 0.9,
                        num_predict: 2048
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                this._view.webview.postMessage({ 
                    command: 'responseChunk', 
                    text: `❌ **Ollama Error (${response.status})**\n\n${errorText}`,
                    isFirst: true
                });
                this._view.webview.postMessage({ command: 'responseComplete' });
                return;
            }

            if (!response.body) {
                this._view.webview.postMessage({ 
                    command: 'responseChunk', 
                    text: 'Error: No response body received from Ollama.',
                    isFirst: true
                });
                this._view.webview.postMessage({ command: 'responseComplete' });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;

                    try {
                        const json = JSON.parse(line);
                        if (json.response) {
                            fullResponse += json.response;
                            this._view.webview.postMessage({
                                command: 'responseChunk',
                                text: json.response,
                                isFirst: isFirstChunk
                            });
                            isFirstChunk = false;
                        }
                        if (json.done) {
                            // Store the conversation in chat memory
                            if (fullResponse.trim()) {
                                try {
                                    await storeChatMemory(input, fullResponse, currentUserId, currentSessionId);
                                } catch (error) {
                                    console.error('Failed to store chat memory:', error);
                                    // Continue without storing - this is optional
                                }
                            }
                            this._view.webview.postMessage({ command: 'responseComplete' });
                            return;
                        }
                    } catch (e) {
                        console.error('Error parsing JSON line:', e, 'Line:', line);
                    }
                }
            }
        } catch (error) {
            console.error('Error with Ollama DeepSeek streaming:', error);
            
            let errorMessage = '❌ **Unexpected Error**\n\nPlease try again or restart Ollama.';
            
            if (error instanceof Error) {
                if (error.message.includes('fetch failed')) {
                    errorMessage = '❌ **Cannot connect to Ollama**\n\nMake sure Ollama is running: `ollama serve`';
                } else if (error.message.includes('ECONNREFUSED')) {
                    errorMessage = '❌ **Connection refused**\n\nOllama is not running. Start it with: `ollama serve`';
                }
            }
            
            this._view.webview.postMessage({ 
                command: 'responseChunk', 
                text: errorMessage,
                isFirst: true
            });
            this._view.webview.postMessage({ command: 'responseComplete' });
        }
    }
    // --- END STREAMING METHOD ---
}

/**
 * Generate a nonce for security - this function is not used in the provided snippet but good practice.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0987654321';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}