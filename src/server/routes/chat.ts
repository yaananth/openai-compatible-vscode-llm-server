import { Router } from 'express';
import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';
import { ChatMessage } from '../../config/types';

function createRouter(logger: Logger): Router {
    const router = Router();

    router.post('/completions', async (req, res) => {
    logger.log('Chat completion request received');
    logger.log(`Request body: ${JSON.stringify(req.body, null, 2)}`);
    
    const { messages, stream = false, model: requestedModel } = req.body;

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }

    try {
        const craftedPrompt = messages.map((msg: ChatMessage) => {
            return msg.role === 'user'
                ? vscode.LanguageModelChatMessage.User(msg.content)
                : vscode.LanguageModelChatMessage.Assistant(msg.content);
        });

        const defaultModel = vscode.workspace.getConfiguration('openaiCompatibleServer').get('defaultModel', 'gpt-4o');
        const modelId = requestedModel || defaultModel;
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelId });
        
        let model: vscode.LanguageModelChat | undefined;
        if (!models || models.length === 0) {
            const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'alternativeModel' });
            if (fallbackModels && fallbackModels.length > 0) {
                model = fallbackModels[0];
            } else {
                throw new Error(`No model available for requested family: ${modelId}`);
            }
        } else {
            model = models[0];
        }

        logger.log(`Selected model: ${modelId}`);

        let chatResponse = await model.sendRequest(craftedPrompt, {}, new vscode.CancellationTokenSource().token);

        if (!chatResponse) {
            logger.log('No response received from language model');
            throw new Error('No response from language model');
        }

        if (stream) {
            logger.log('Starting streaming response');
            const initialResponse = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant'
                        }
                    }
                ]
            };
            res.write(`data: ${JSON.stringify(initialResponse)}\n\n`);

            try {
                for await (const fragment of chatResponse.text) {
                    const chunk = {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    content: fragment
                                }
                            }
                        ]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }

                res.write('data: [DONE]\n\n');
                res.end();
            } catch (error) {
                const errorChunk = {
                    error: {
                        message: error instanceof Error ? error.message : 'Stream interrupted',
                        type: 'server_error'
                    }
                };
                res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
                res.end();
            }
        } else {
            logger.log('Generating non-streaming response');
            let responseText = '';
            for await (const fragment of chatResponse.text) {
                responseText += fragment;
            }

            res.json({
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: responseText
                        },
                        finish_reason: 'stop'
                    }
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            });
        }
    } catch (error) {
        logger.log(`Error in chat completion: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error('Error generating response:', error);
        res.status(500).json({
            error: {
                message: 'Error generating response from language model',
                type: 'internal_server_error'
            }
        });
    }
    });

    return router;
}

export default createRouter;
