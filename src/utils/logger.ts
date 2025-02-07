import * as fs from 'fs';
import * as vscode from 'vscode';

export class Logger {
    private static instance: Logger;
    private logFilePath: string;

    private constructor(logFilePath: string) {
        this.logFilePath = logFilePath;
    }

    public static initialize(logFilePath: string): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(logFilePath);
        }
        return Logger.instance;
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            throw new Error('Logger not initialized');
        }
        return Logger.instance;
    }

    public log(message: string): void {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${message}\n`;
        fs.appendFileSync(this.logFilePath, logEntry);
    }

    public async showLogs(): Promise<void> {
        if (!this.logFilePath || !fs.existsSync(this.logFilePath)) {
            vscode.window.showErrorMessage('No logs available');
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(this.logFilePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open logs: ${error}`);
        }
    }
}
