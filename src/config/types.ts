import * as vscode from 'vscode';

export interface ServerConfig {
    port: number;
    defaultModel: string;
    autoStart: boolean;
}

export interface ExtensionState {
    server: import('http').Server | undefined;
    statusBarItem: vscode.StatusBarItem;
    app: import('express').Application;
    logFilePath: string;
}

export interface ChatMessage {
    role: string;
    content: string;
}
