import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { StatusBarManager } from './statusBar/statusBar';
import { ServerManager } from './server/server';

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger with extension context
    const logger = Logger.initialize(context);
    logger.log('Extension activated');

    // Initialize managers in correct order
    const statusBar = StatusBarManager.initialize(logger);
    const serverManager = ServerManager.initialize(logger, statusBar);

    // Register commands
    let startCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.start', () => {
        void serverManager.start();
    });

    let stopCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.stop', () => {
        void serverManager.stop();
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

    // Register all commands and disposables
    context.subscriptions.push(
        startCommand,
        stopCommand,
        statusCommand,
        viewLogsCommand,
        logger
    );

    // Handle auto-start
    const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
    const autoStart = config.get('autoStart', false);

    if (autoStart) {
        serverManager.start().catch(err => {
            vscode.window.showErrorMessage('Failed to start server automatically: ' + err);
        });
    }
}

export async function deactivate() {
    const logger = Logger.getInstance();
    const serverManager = ServerManager.getInstance();
    const statusBar = StatusBarManager.getInstance();

    if (serverManager.isRunning()) {
        await serverManager.stop();
        logger.log('Server stopped during extension deactivation');
    }

    statusBar.dispose();
    logger.log('Extension deactivated');
}
