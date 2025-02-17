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
            if (!Array.isArray(messages)) {
                throw new Error('Messages must be an array');
            }

            const craftedPrompt = messages.map((msg: ChatMessage, index: number) => {
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
            });

            // Check if language model API is available
            if (!vscode.lm) {
                throw new Error('Language model API not available. Please ensure the GitHub Copilot extension is installed and activated.');
            }

            // Get configuration and model ID
            const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
            const defaultModel = config.get('defaultModel', 'gpt-4');
            const modelId = requestedModel || defaultModel;

            logger.log('Selecting model for chat...');
            logger.log(`Requested model ID: ${modelId}`);

            let model: vscode.LanguageModelChat;
            try {
                // Try to get available models
                const models = await vscode.lm.selectChatModels();

                if (!models || models.length === 0) {
                    throw new Error('No language models available. Please check your GitHub Copilot connection.');
                }

                logger.log(`Found ${models.length} available models`);
                model = models[0];

                if (!model) {
                    throw new Error('Failed to initialize language model');
                }

                // Test the model with a simple request to verify it's working
                const testResponse = await model.sendRequest(
                    [vscode.LanguageModelChatMessage.User('Test connection')],
                    {},
                    new vscode.CancellationTokenSource().token
                );

                if (!testResponse) {
                    throw new Error('Language model test request failed');
                }

                logger.log('Language model initialized successfully');
            } catch (modelError) {
                logger.log(`Model initialization error: ${modelError instanceof Error ? modelError.message : 'Unknown error'}`);
                throw new Error('Failed to initialize language model. Please ensure GitHub Copilot is properly configured.');
            }

            logger.log('Sending request to model...');
            const cancellationToken = new vscode.CancellationTokenSource().token;
            const chatResponse = await model.sendRequest(craftedPrompt, {}, cancellationToken);

            if (!chatResponse) {
                logger.log('No response received from language model');
                throw new Error('No response from language model');
            }

            let promptTokenValue = 0;
            for (const msg of messages) {
                promptTokenValue += await model.countTokens(msg.content);
            }

            let responseTextAll = '';

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
                    let iterator = chatResponse.text[Symbol.asyncIterator]();
                    let result;
                    while ((result = await iterator.next())) {
                        const fragment = result.value;
                        responseTextAll += fragment;
                        const isLast = result.done;

                        const chunk: {
                            id: string;
                            object: string;
                            created: number;
                            model: any;
                            choices: {
                                index: number;
                                delta: {
                                    content: any;
                                };
                            }[];
                            usage?: {
                                prompt_tokens: number;
                                completion_tokens: number;
                                total_tokens: number;
                            };
                        } = {
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

                        if (isLast) {

                            const completionTokens: Thenable<number> = model.countTokens(responseTextAll);
                            const [completionTokenValue] = await Promise.all([completionTokens]);

                            const finalChunk = {
                                id: 'chatcmpl-' + Date.now(),
                                object: 'chat.completion.chunk',
                                created: Math.floor(Date.now() / 1000),
                                model: modelId,
                                choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: 'stop'
                                }],
                                usage: {
                                    prompt_tokens: promptTokenValue,
                                    completion_tokens: completionTokenValue,
                                    total_tokens: promptTokenValue + completionTokenValue
                                }
                            };
                            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                            break;
                        }
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }

                    res.end();
                } catch (error) {
                    if (error instanceof Error) {
                        logger.log(`Streaming error: ${error.message}`);
                        logger.log(`Stack trace: ${error.stack}`);
                    } else {
                        logger.log('Unknown streaming error');
                    }
                    try {
                        const errorMessage = error instanceof Error ? error.message : 'Stream interrupted';
                        const errorChunk = {
                            error: {
                                message: errorMessage,
                                type: 'server_error'
                            }
                        };
                        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
                    } catch (writeError) {
                        logger.log(`Failed to write error response: ${writeError instanceof Error ? writeError.message : 'Unknown write error'}`);
                    } finally {
                        res.end();
                    }
                }
            } else {
                logger.log('Generating non-streaming response');
                let responseText = '';
                for await (const fragment of chatResponse.text) {
                    responseText += fragment;
                }

                const completionTokens: Thenable<number> = model.countTokens(responseText);
                const [completionTokenValue] = await Promise.all([completionTokens]);

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
                        prompt_tokens: promptTokenValue,
                        completion_tokens: completionTokenValue,
                        total_tokens: promptTokenValue + completionTokenValue
                    }
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.log(`Error in chat completion: ${errorMessage}`);
            console.error('Error generating response:', error);
            res.status(500).json({
                error: {
                    message: errorMessage,
                    type: 'server_error'
                }
            });
        }
    });

    return router;
}

export default createRouter;
