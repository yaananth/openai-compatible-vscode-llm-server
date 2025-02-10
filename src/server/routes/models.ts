import { Router } from 'express';
import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';

function createRouter(logger: Logger): Router {
    const router = Router();

    router.get('/', async (req, res) => {
        logger.log('Models endpoint accessed');

        try {
            const modelData = [];
            const uniqueFamilies = new Set<string>();

            // Try to discover available models through the VSCode LLM API
            try {
                // First try without any filters to discover what's available
                const defaultModels = await vscode.lm.selectChatModels({});
                if (defaultModels && defaultModels.length > 0) {
                    for (const model of defaultModels) {
                        if (model.family && !uniqueFamilies.has(model.family)) {
                            uniqueFamilies.add(model.family);
                            modelData.push({
                                id: model.family,
                                object: 'model',
                                created: Math.floor(Date.now() / 1000),
                                owned_by: model.vendor || 'unknown'
                            });
                        }
                    }
                }
            } catch (error) {
                logger.log(`Error discovering default models: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // If no models found through initial discovery, try with specific vendor
            if (modelData.length === 0) {
                try {
                    const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
                    if (copilotModels && copilotModels.length > 0) {
                        for (const model of copilotModels) {
                            if (model.family && !uniqueFamilies.has(model.family)) {
                                uniqueFamilies.add(model.family);
                                modelData.push({
                                    id: model.family,
                                    object: 'model',
                                    created: Math.floor(Date.now() / 1000),
                                    owned_by: 'copilot'
                                });
                            }
                        }
                    }
                } catch (error) {
                    logger.log(`Error discovering Copilot models: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            if (modelData.length === 0) {
                logger.log('No models available from VSCode LLM API');
                throw new Error('No models available');
            }

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
