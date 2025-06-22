import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "deepseekaiextension" is now active!');

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
}

// This method is called when your extension is deactivated
export function deactivate() {}

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

        // First check if Ollama is running and the model is available
        try {
            const healthCheck = await fetch('http://localhost:11434/api/tags', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
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
                model.name === 'deepseek-r1:8b-llama-distill-q4_K_M'
            );

            if (!modelExists) {
                this._view.webview.postMessage({ 
                    command: 'responseChunk', 
                    text: '❌ **Model not found!**\n\nThe DeepSeek model is not installed.\n\n**To install it, run:**\n```bash\nollama pull deepseek-r1:8b-llama-distill-q4_K_M\n```\n\nThis may take a few minutes depending on your internet connection.',
                    isFirst: true
                });
                this._view.webview.postMessage({ command: 'responseComplete' });
                return;
            }

        } catch (error) {
            console.error('Ollama health check failed:', error);
            this._view.webview.postMessage({ 
                command: 'responseChunk', 
                text: '❌ **Ollama is not running!**\n\nTo use DeepSeek AI:\n\n1. **Install Ollama** from https://ollama.ai\n2. **Start Ollama** (run `ollama serve` in terminal)\n3. **Pull the model**: `ollama pull deepseek-r1:8b-llama-distill-q4_K_M`\n4. **Try again**',
                isFirst: true
            });
            this._view.webview.postMessage({ command: 'responseComplete' });
            return;
        }

        try {
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'deepseek-r1:8b-llama-distill-q4_K_M',
                    prompt: input,
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
                            this._view.webview.postMessage({
                                command: 'responseChunk',
                                text: json.response,
                                isFirst: isFirstChunk
                            });
                            isFirstChunk = false;
                        }
                        if (json.done) {
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