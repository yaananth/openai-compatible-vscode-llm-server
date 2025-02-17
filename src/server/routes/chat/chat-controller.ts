import { Request, Response } from 'express';
import { Logger } from '../../../utils/logger';
import { ModelManager } from './model-manager';
import { ResponseFormatter } from './response-formatter';
import { StreamHandler } from './stream-handler';
import { ChatMessage } from '../../../config/types';
import * as vscode from 'vscode';

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

            const model = await this.modelManager.getModel();
            const modelId = requestedModel || await this.modelManager.getModelId();

            const craftedPrompt = messages.map((msg: ChatMessage, index: number) => 
                this.modelManager.createChatMessage(msg, index)
            );

            const cancellationToken = new vscode.CancellationTokenSource().token;
            const chatResponse = await model.sendRequest(craftedPrompt, {}, cancellationToken);

            if (!chatResponse) {
                this.logger.log('No response received from language model');
                throw new Error('No response from language model');
            }

            let promptTokenValue = 0;
            for (const msg of messages) {
                promptTokenValue += await this.modelManager.countTokens(model, msg.content);
            }

            if (stream) {
                await this.handleStreamResponse(res, chatResponse, modelId, promptTokenValue);
            } else {
                await this.handleNonStreamResponse(res, chatResponse, modelId, promptTokenValue, model);
            }
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private async handleStreamResponse(
        res: Response, 
        chatResponse: vscode.LanguageModelChatResponse,
        modelId: string,
        promptTokens: number
    ): Promise<void> {
        const streamHandler = new StreamHandler(
            res,
            modelId,
            this.logger,
            this.responseFormatter,
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
