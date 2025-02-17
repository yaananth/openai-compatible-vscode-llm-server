import * as vscode from 'vscode';
import { Logger } from '../../../utils/logger';

export class ModelManager {
    constructor(private logger: Logger) {}

    async getModel(): Promise<vscode.LanguageModelChat> {
        if (!vscode.lm) {
            throw new Error('Language model API not available. Please ensure the GitHub Copilot extension is installed and activated.');
        }

        const models = await vscode.lm.selectChatModels();

        if (!models || models.length === 0) {
            throw new Error('No language models available. Please check your GitHub Copilot connection.');
        }

        this.logger.log(`Found ${models.length} available models`);
        const model = models[0];

        if (!model) {
            throw new Error('Failed to initialize language model');
        }

        // Test the model with a simple request
        await this.testModel(model);
        
        this.logger.log('Language model initialized successfully');
        return model;
    }

    private async testModel(model: vscode.LanguageModelChat): Promise<void> {
        const testResponse = await model.sendRequest(
            [vscode.LanguageModelChatMessage.User('Test connection')],
            {},
            new vscode.CancellationTokenSource().token
        );

        if (!testResponse) {
            throw new Error('Language model test request failed');
        }
    }

    async getModelId(): Promise<string> {
        const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
        return config.get('defaultModel', 'gpt-4');
    }

    async countTokens(model: vscode.LanguageModelChat, text: string): Promise<number> {
        return await model.countTokens(text);
    }

    createChatMessage(msg: { role: string; content: string }, index: number): vscode.LanguageModelChatMessage {
        if (!msg || typeof msg !== 'object') {
            throw new Error(`Invalid message at index ${index}: message must be an object`);
        }
        if (!msg.role || typeof msg.role !== 'string') {
            throw new Error(`Invalid message at index ${index}: missing or invalid 'role' property`);
        }
        if (!msg.content || typeof msg.content !== 'string') {
            throw new Error(`Invalid message at index ${index}: missing or invalid 'content' property`);
        }

        switch (msg.role) {
            case 'user':
                return vscode.LanguageModelChatMessage.User(msg.content);
            case 'system':
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(msg.content);
            default:
                throw new Error(`Invalid message at index ${index}: role must be 'system', 'user', or 'assistant'`);
        }
    }
}
