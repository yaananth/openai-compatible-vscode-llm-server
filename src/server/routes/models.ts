import { Router } from 'express';
import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';
import { MODEL_PRESETS } from './shared/model-presets';

function createRouter(logger: Logger): Router {
    const router = Router();

    router.get('/', async (_req, res) => {
        logger.log('Models endpoint accessed');

        try {
            if (!vscode.lm) {
                throw new Error('Language model API not available. Please ensure the GitHub Copilot extension is installed and activated.');
            }

            const modelMap = new Map<string, {
                id: string;
                object: 'model';
                created: number;
                owned_by: string;
                metadata: {
                    name: string;
                    family: string;
                    version: string;
                    max_input_tokens: number;
                    [key: string]: unknown;
                };
            }>();

            const selectors: vscode.LanguageModelChatSelector[] = [
                {},
                { vendor: 'copilot' },
                { vendor: 'openrouter' }
            ];

            for (const selector of selectors) {
                try {
                    const models = await vscode.lm.selectChatModels(selector);
                    if (!models) {
                        continue;
                    }

                    for (const model of models) {
                        const id = model.id || model.family || model.name;
                        if (!id || modelMap.has(id)) {
                            continue;
                        }

                        modelMap.set(id, {
                            id,
                            object: 'model',
                            created: Math.floor(Date.now() / 1000),
                            owned_by: model.vendor || 'unknown',
                            metadata: {
                                name: model.name,
                                family: model.family,
                                version: model.version,
                                max_input_tokens: model.maxInputTokens
                            }
                        });
                    }
                } catch (selectorError) {
                    logger.log(`Model discovery failed for selector ${JSON.stringify(selector)}: ${selectorError instanceof Error ? selectorError.message : 'Unknown error'}`);
                }
            }

            if (modelMap.size === 0) {
                logger.log('No models available from VSCode LLM API');
                throw new Error('No models available');
            }

            for (const preset of MODEL_PRESETS) {
                if (modelMap.has(preset.id)) {
                    continue;
                }

                let baseEntry: {
                    id: string;
                    object: 'model';
                    created: number;
                    owned_by: string;
                    metadata: {
                        name: string;
                        family: string;
                        version: string;
                        max_input_tokens: number;
                        [key: string]: unknown;
                    };
                } | undefined;
                let resolvedBaseId: string | undefined;

                for (const candidate of preset.baseModelIds) {
                    const entry = modelMap.get(candidate);
                    if (entry) {
                        baseEntry = entry;
                        resolvedBaseId = entry.id;
                        break;
                    }
                }

                if (!baseEntry) {
                    continue;
                }

                modelMap.set(preset.id, {
                    ...baseEntry,
                    id: preset.id,
                    metadata: {
                        ...baseEntry.metadata,
                        name: preset.displayName,
                        alias_for: resolvedBaseId ?? baseEntry.id,
                        preset_reasoning: preset.reasoning ?? null,
                        preset_description: preset.description
                    }
                });
            }

            const modelData = Array.from(modelMap.values()).sort((a, b) => a.id.localeCompare(b.id));

            res.json({
                object: 'list',
                data: modelData
            });
        } catch (error) {
            logger.log(`Error fetching models: ${error instanceof Error ? error.message : 'Unknown error'}`);
            res.status(500).json({
                error: {
                    message: 'Error fetching available models',
                    type: 'internal_server_error'
                }
            });
        }
    });

    return router;
}

export default createRouter;
