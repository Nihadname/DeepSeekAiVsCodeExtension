import * as vscode from 'vscode';
import * as path from 'path';

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "deepseekaiextension" is now active!');

	// Register command to open the panel
	let disposable = vscode.commands.registerCommand('deepseekaiextension.openPanel', () => {
		DeepSeekPanel.createOrShow(context.extensionUri);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}

/**
 * Manages the DeepSeek AI Panel
 */
class DeepSeekPanel {
	public static currentPanel: DeepSeekPanel | undefined;
	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri) {
		// If we already have a panel, reveal it
		if (DeepSeekPanel.currentPanel) {
			DeepSeekPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			'deepseekPanel',
			'DeepSeek AI Chat',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
			}
		);

		DeepSeekPanel.currentPanel = new DeepSeekPanel(panel, extensionUri);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;

		// Set the HTML content for the panel
		this._update();

		// Dispose of panel when closed
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(async (message) => {
			if (message.command === 'askDeepSeek') {
				const userInput = message.text;
				const response = await this.getDeepSeekResponse(userInput);
				this._panel.webview.postMessage({ command: 'response', text: response });
			}
		}, null, this._disposables);
	}

	public dispose() {
		DeepSeekPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private _update() {
		this._panel.webview.html = this._getHtmlForWebview();
	}

	private _getHtmlForWebview() {
		const nonce = getNonce();
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>DeepSeek AI Chat</title>
			<style>
				body {
					font-family: Arial, sans-serif;
					margin: 0;
					padding: 10px;
					background-color: #1e1e1e;
					color: white;
				}
				.container {
					display: flex;
					flex-direction: column;
					height: 100vh;
					gap: 10px;
				}
				#messages {
					flex-grow: 1;
					overflow-y: auto;
					padding: 10px;
					background: #252526;
					border-radius: 5px;
				}
				.message {
					margin-bottom: 15px;
					padding: 10px;
					border-radius: 5px;
				}
				.user-message {
					background: #2d2d2d;
					border-left: 3px solid #007acc;
				}
				.ai-message {
					background: #2d2d2d;
					border-left: 3px solid #4CAF50;
				}
				.message-header {
					font-weight: bold;
					margin-bottom: 5px;
					color: #cccccc;
				}
				.message-content {
					white-space: pre-wrap;
					line-height: 1.4;
				}
				.code-block {
					background: #1e1e1e;
					padding: 10px;
					border-radius: 5px;
					font-family: 'Consolas', 'Courier New', monospace;
					margin: 10px 0;
					position: relative;
				}
				.code-block-header {
					background: #333;
					padding: 5px 10px;
					border-radius: 5px 5px 0 0;
					font-size: 0.9em;
					color: #ccc;
				}
				.copy-button {
					position: absolute;
					right: 5px;
					top: 5px;
					background: #333;
					border: none;
					color: #fff;
					padding: 5px 10px;
					border-radius: 3px;
					cursor: pointer;
					font-size: 12px;
				}
				.copy-button:hover {
					background: #444;
				}
				.input-area {
					display: flex;
					gap: 10px;
				}
				textarea {
					flex-grow: 1;
					padding: 10px;
					border-radius: 5px;
					border: 1px solid #555;
					background-color: #333;
					color: white;
					min-height: 60px;
					resize: vertical;
					font-family: inherit;
				}
				button {
					padding: 10px 15px;
					border: none;
					background-color: #007acc;
					color: white;
					border-radius: 5px;
					cursor: pointer;
				}
				button:hover {
					background-color: #005f9e;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div id="messages"></div>
				<div class="input-area">
					<textarea id="userInput" placeholder="Ask DeepSeek AI..."></textarea>
					<button onclick="sendMessage()">Send</button>
				</div>
			</div>
			<script>
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

				function copyToClipboard(text) {
					navigator.clipboard.writeText(text).then(() => {
						// Could add a copied confirmation here
					});
				}

				function detectAndFormatCodeBlocks(text) {
					const codeBlockRegex = /\`\`\`([\w-]*)([\s\S]*?)\`\`\`/g;
					let formattedText = text;
					let match;
					
					while ((match = codeBlockRegex.exec(text)) !== null) {
						const language = match[1];
						const code = match[2].trim();
						const replacement = 
							'<div class="code-block">' +
							'<div class="code-block-header">' + (language || 'plaintext') + '</div>' +
							'<button class="copy-button" onclick="copyToClipboard(' + JSON.stringify(code) + ')">Copy</button>' +
							'<pre><code>' + escapeHtml(code) + '</code></pre>' +
							'</div>';
						formattedText = formattedText.replace(match[0], replacement);
					}
					return formattedText;
				}

				function escapeHtml(unsafe) {
					return unsafe
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;")
						.replace(/"/g, "&quot;")
						.replace(/'/g, "&#039;");
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
					
					const formattedText = detectAndFormatCodeBlocks(text);
					contentDiv.innerHTML = formattedText;
					
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
			</script>
		</body>
		</html>`;
	}

	private async getDeepSeekResponse(input: string): Promise<string> {
		try {
			const response = await fetch('http://localhost:11434/api/generate', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: 'deepseek-r1:1.5b',
					prompt: input,
					stream: false
				})
			});

			const data = await response.json();
			return data.response || 'No response received.';
		} catch (error) {
			console.error('Error with Ollama DeepSeek:', error);
			return 'Error: Make sure Ollama is running and DeepSeek model is installed.';
		}
	}
}

/**
 * Generate a nonce for security
 */
function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}