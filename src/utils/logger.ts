import * as vscode from 'vscode';

export class Logger {
    private static instance: Logger;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel("OpenAI Compatible Server", { log: true });
    }

    public static initialize(context: vscode.ExtensionContext): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(context);
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
        this.outputChannel.appendLine(message);
    }

    public async showLogs(): Promise<void> {
        this.outputChannel.show();
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}
