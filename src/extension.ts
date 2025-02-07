import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './utils/logger';
import { StatusBarManager } from './statusBar/statusBar';
import { ServerManager } from './server/server';

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    const logFilePath = context.storageUri 
        ? path.join(context.storageUri.fsPath, 'server.log')
        : path.join(context.extensionUri.fsPath, 'server.log');
    
    const logger = Logger.initialize(logFilePath);
    logger.log('Extension activated');

    // Initialize managers in correct order
    const statusBar = StatusBarManager.initialize(logger);
    const serverManager = ServerManager.initialize(logger, statusBar);

    // Register commands
    let startCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.start', () => {
        serverManager.start();
    });

    let stopCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.stop', () => {
        serverManager.stop();
    });

    let statusCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.status', () => {
        if (serverManager.isRunning()) {
            const port = serverManager.getServerPort();
            vscode.window.showInformationMessage(`Server is running on http://localhost:${port}`);
        } else {
            vscode.window.showInformationMessage('Server is not running');
        }
    });

    let viewLogsCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.viewLogs', () => {
        logger.showLogs();
    });

    // Register all commands
    context.subscriptions.push(startCommand);
    context.subscriptions.push(stopCommand);
    context.subscriptions.push(statusCommand);
    context.subscriptions.push(viewLogsCommand);

    // Handle auto-start
    const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
    const autoStart = config.get('autoStart', false);

    if (autoStart) {
        try {
            serverManager.start();
        } catch (err) {
            vscode.window.showErrorMessage('Failed to start server automatically: ' + err);
        }
    }
}

export function deactivate() {
    const logger = Logger.getInstance();
    const serverManager = ServerManager.getInstance();
    const statusBar = StatusBarManager.getInstance();

    if (serverManager.isRunning()) {
        serverManager.stop();
        logger.log('Server stopped during extension deactivation');
    }
    
    statusBar.dispose();
    logger.log('Extension deactivated');
}
