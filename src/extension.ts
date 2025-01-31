import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
		const scriptUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js');
		const styleUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css');
		const htmlUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'main.html');

		const scriptSrc = this._panel.webview.asWebviewUri(scriptUri);
		const styleSrc = this._panel.webview.asWebviewUri(styleUri);

		const htmlContent = fs.readFileSync(htmlUri.fsPath, 'utf8');
		
		return htmlContent
			.replace('${scriptUri}', scriptSrc.toString())
			.replace('${styleUri}', styleSrc.toString());
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