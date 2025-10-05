import { Request, Response } from 'express';
import { Logger } from '../../../utils/logger';
import { ModelManager } from './model-manager';
import { ResponseFormatter } from './response-formatter';
import { StreamHandler } from './stream-handler';
import { ChatMessage } from '../../../config/types';
import * as vscode from 'vscode';
import { resolveModelPreset } from '../shared/model-presets';

export class ChatController {
    private modelManager: ModelManager;
    private responseFormatter: ResponseFormatter;

    constructor(private logger: Logger) {
        this.modelManager = new ModelManager(logger);
        this.responseFormatter = new ResponseFormatter();
    }

    async handleChatCompletion(req: Request, res: Response): Promise<void> {
        this.logger.log('Chat completion request received');
        this.logger.log(`Request body: ${JSON.stringify(req.body, null, 2)}`);

        const { messages, stream = false, model: requestedModel } = req.body;

        try {
            if (!Array.isArray(messages)) {
                throw new Error('Messages must be an array');
            }

            const preset = resolveModelPreset(requestedModel);
            if (preset) {
                this.logger.log(`Applying model preset "${preset.id}" targeting base ids: ${preset.baseModelIds.join(', ')}`);
            }

            const presetReasoning = preset?.reasoning;
            if (presetReasoning) {
                this.logger.log(`Applying reasoning options for chat completion: ${JSON.stringify(presetReasoning)}`);
            }

            const model = await this.modelManager.getModel(requestedModel);
            const resolvedModelId = this.modelManager.getActiveModelIdentifier() || model.id || requestedModel || await this.modelManager.getModelId();
            const responseModelId = preset ? preset.id : resolvedModelId;

            const craftedPrompt = messages.map((msg: ChatMessage, index: number) => 
                this.modelManager.createChatMessage(msg, index)
            );

            const cancellationToken = new vscode.CancellationTokenSource().token;
            const requestOptions = presetReasoning ? { modelOptions: { reasoning: presetReasoning } } : undefined;
            const chatResponse = await model.sendRequest(craftedPrompt, requestOptions, cancellationToken);

            if (!chatResponse) {
                this.logger.log('No response received from language model');
                throw new Error('No response from language model');
            }

            let promptTokenValue = 0;
            for (const msg of messages) {
                promptTokenValue += await this.modelManager.countTokens(model, msg.content);
            }

            if (stream) {
                await this.handleStreamResponse(res, chatResponse, responseModelId, promptTokenValue, model);
            } else {
                await this.handleNonStreamResponse(res, chatResponse, responseModelId, promptTokenValue, model);
            }
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private async handleStreamResponse(
        res: Response, 
        chatResponse: vscode.LanguageModelChatResponse,
        modelId: string,
        promptTokens: number,
        model: vscode.LanguageModelChat
    ): Promise<void> {
        const streamHandler = new StreamHandler(
            res,
            modelId,
            this.logger,
            this.responseFormatter,
            model,
            this.modelManager
        );

        streamHandler.initializeStream();
        await streamHandler.handleStream(chatResponse, promptTokens);
    }

    private async handleNonStreamResponse(
        res: Response,
        chatResponse: vscode.LanguageModelChatResponse,
        modelId: string,
        promptTokens: number,
        model: vscode.LanguageModelChat
    ): Promise<void> {
        this.logger.log('Generating non-streaming response');
        let responseText = '';
        for await (const fragment of chatResponse.text) {
            responseText += fragment;
        }

        const completionTokens = await this.modelManager.countTokens(model, responseText);
        const response = this.responseFormatter.createChatCompletionResponse(
            modelId,
            responseText,
            promptTokens,
            completionTokens
        );

        res.json(response);
    }

    private handleError(res: Response, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.log(`Error in chat completion: ${errorMessage}`);
        console.error('Error generating response:', error);
        
        const errorResponse = this.responseFormatter.createErrorResponse(error);
        res.status(500).json(errorResponse);
    }
}
