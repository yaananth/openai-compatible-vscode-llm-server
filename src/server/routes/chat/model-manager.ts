import * as vscode from 'vscode';
import { Logger } from '../../../utils/logger';

export class ModelManager {
    private cachedModels = new Map<string, vscode.LanguageModelChat>();
    private lastSelectedModel?: { id: string; model: vscode.LanguageModelChat };

    constructor(private logger: Logger) {}

    async getModel(preferredModelId?: string): Promise<vscode.LanguageModelChat> {
        if (!vscode.lm) {
            throw new Error('Language model API not available. Please ensure the GitHub Copilot extension is installed and activated.');
        }

        const targetId = preferredModelId?.trim() || await this.getModelId();

        if (targetId) {
            const cached = this.cachedModels.get(targetId);
            if (cached) {
                this.lastSelectedModel = { id: cached.id, model: cached };
                return cached;
            }
        }

        const selectors: vscode.LanguageModelChatSelector[] = [];

        if (preferredModelId?.trim()) {
            const normalized = preferredModelId.trim();
            selectors.push({ id: normalized });
            selectors.push({ family: normalized });
        }

        if (!preferredModelId && targetId) {
            selectors.push({ id: targetId });
            selectors.push({ family: targetId });
        }

        selectors.push({});

        for (const selector of selectors) {
            try {
                const models = await vscode.lm.selectChatModels(selector);
                if (!models || models.length === 0) {
                    continue;
                }

                const selected = this.selectModelFromList(models, preferredModelId, targetId);
                await this.ensureModelReady(selected);
                this.cacheModel(selected);
                this.lastSelectedModel = { id: selected.id, model: selected };
                this.logger.log(`Using language model ${selected.name} (${selected.id})`);
                return selected;
            } catch (error) {
                this.logger.log(`Selector ${JSON.stringify(selector)} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        throw new Error('No language models available. Please check your GitHub Copilot connection.');
    }

    private selectModelFromList(
        models: readonly vscode.LanguageModelChat[],
        preferredModelId?: string,
        fallbackId?: string
    ): vscode.LanguageModelChat {
        const trimmedPreferred = preferredModelId?.trim();
        const trimmedFallback = fallbackId?.trim();

        if (trimmedPreferred) {
            const match = models.find(model => model.id === trimmedPreferred || model.family === trimmedPreferred);
            if (match) {
                return match;
            }
        }

        if (trimmedFallback && trimmedFallback !== trimmedPreferred) {
            const fallbackMatch = models.find(model => model.id === trimmedFallback || model.family === trimmedFallback);
            if (fallbackMatch) {
                return fallbackMatch;
            }
        }

        return models[0];
    }

    private async ensureModelReady(model: vscode.LanguageModelChat): Promise<void> {
        if (!this.lastSelectedModel || this.lastSelectedModel.id !== model.id) {
            await this.testModel(model);
        }
    }

    private cacheModel(model: vscode.LanguageModelChat): void {
        this.cachedModels.set(model.id, model);
        if (model.family) {
            this.cachedModels.set(model.family, model);
        }
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

    getActiveModelIdentifier(): string | undefined {
        return this.lastSelectedModel?.id;
    }

    async getModelId(): Promise<string> {
        const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
        return config.get('defaultModel', 'claude-sonnet-4.5');
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
