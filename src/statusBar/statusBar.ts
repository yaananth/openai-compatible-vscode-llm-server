import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export class StatusBarManager {
    private static instance: StatusBarManager;
    private statusBarItem: vscode.StatusBarItem;

    private constructor(logger: Logger) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.show();
    }

    public static initialize(logger: Logger): StatusBarManager {
        if (!StatusBarManager.instance) {
            StatusBarManager.instance = new StatusBarManager(logger);
        }
        return StatusBarManager.instance;
    }

    public static getInstance(): StatusBarManager {
        if (!StatusBarManager.instance) {
            throw new Error('StatusBarManager not initialized');
        }
        return StatusBarManager.instance;
    }

    public update(isServerRunning: boolean): void {
        if (isServerRunning) {
            this.statusBarItem.text = '$(stop) Stop API Server';
            this.statusBarItem.tooltip = 'Click to stop OpenAI Compatible Server';
            this.statusBarItem.command = 'openai-compatible-vscode-llm-server.stop';
        } else {
            this.statusBarItem.text = '$(play) Start API Server';
            this.statusBarItem.tooltip = 'Click to start OpenAI Compatible Server';
            this.statusBarItem.command = 'openai-compatible-vscode-llm-server.start';
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }

    public getStatusBarItem(): vscode.StatusBarItem {
        return this.statusBarItem;
    }
}
