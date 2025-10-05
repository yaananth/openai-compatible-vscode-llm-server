import * as vscode from 'vscode';
import { Logger } from '../../../utils/logger';
import { resolveModelPreset } from '../shared/model-presets';

export class ModelManager {
    private cachedModels = new Map<string, vscode.LanguageModelChat>();
    private lastSelectedModel?: { id: string; model: vscode.LanguageModelChat };

    constructor(private logger: Logger) {}

    async getModel(preferredModelId?: string): Promise<vscode.LanguageModelChat> {
        if (!vscode.lm) {
            throw new Error('Language model API not available. Please ensure the GitHub Copilot extension is installed and activated.');
        }

        const preset = resolveModelPreset(preferredModelId);
        const trimmedPreferredIds = preset
            ? preset.baseModelIds.map(id => id.trim()).filter(id => id.length > 0)
            : preferredModelId?.trim()
                ? [preferredModelId.trim()]
                : [];

        const defaultModelId = (await this.getModelId()).trim();
        const cacheLookupIds = new Set<string>();

        if (preferredModelId?.trim()) {
            cacheLookupIds.add(preferredModelId.trim());
        }
        if (preset) {
            cacheLookupIds.add(preset.id);
        }
        trimmedPreferredIds.forEach(id => cacheLookupIds.add(id));
        if (defaultModelId.length > 0) {
            cacheLookupIds.add(defaultModelId);
        }

        for (const id of cacheLookupIds) {
            const cached = this.cachedModels.get(id);
            if (cached) {
                this.lastSelectedModel = { id: cached.id, model: cached };
                return cached;
            }
        }

        const selectors: vscode.LanguageModelChatSelector[] = [];

        for (const id of trimmedPreferredIds) {
            selectors.push({ id });
            selectors.push({ family: id });
        }

        if (!trimmedPreferredIds.includes(defaultModelId) && defaultModelId.length > 0) {
            selectors.push({ id: defaultModelId });
            selectors.push({ family: defaultModelId });
        }

        selectors.push({});

        const selectionPreferredId = trimmedPreferredIds[0] ?? preferredModelId?.trim();

        for (const selector of selectors) {
            try {
                const models = await vscode.lm.selectChatModels(selector);
                if (!models || models.length === 0) {
                    continue;
                }

                const candidateId = (selector as { id?: string; family?: string }).id ?? (selector as { id?: string; family?: string }).family ?? selectionPreferredId;
                const selected = this.selectModelFromList(models, candidateId, defaultModelId);
                await this.ensureModelReady(selected);
                this.cacheModel(selected);

                if (preferredModelId?.trim()) {
                    this.cachedModels.set(preferredModelId.trim(), selected);
                }
                if (preset) {
                    for (const id of preset.baseModelIds) {
                        const trimmed = id.trim();
                        if (trimmed.length > 0) {
                            this.cachedModels.set(trimmed, selected);
                        }
                    }
                    this.cachedModels.set(preset.id, selected);
                }

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
