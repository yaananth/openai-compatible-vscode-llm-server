import { Request, Response } from 'express';
import * as vscode from 'vscode';
import { Logger } from '../../../utils/logger';
import { ModelManager } from '../chat/model-manager';
import { ResponseFormatter } from '../chat/response-formatter';
import { ChatMessage } from '../../../config/types';
import { ResponsesStreamHandler } from './stream-handler';

export class ResponsesController {
    private modelManager: ModelManager;
    private responseFormatter: ResponseFormatter;

    constructor(private logger: Logger) {
        this.modelManager = new ModelManager(logger);
        this.responseFormatter = new ResponseFormatter();
    }

    async handleResponse(req: Request, res: Response): Promise<void> {
        this.logger.log('Responses API request received');
        this.logger.log(`Request body: ${JSON.stringify(req.body, null, 2)}`);

        const { input, model: requestedModel, stream = false, instructions, previous_response_id: previousResponseId } = req.body;

        if (previousResponseId) {
            const error = new Error('previous_response_id is not supported yet.');
            res.status(400).json(this.responseFormatter.createErrorResponse(error));
            return;
        }

        const instructionText = this.extractText(instructions);

        try {
            const messages = this.buildMessages(input, instructionText, req.body.messages);

            if (messages.length === 0) {
                throw new Error('No input provided. Supply `input` or `messages` with at least one entry.');
            }

            const model = await this.modelManager.getModel(requestedModel);
            const modelId = this.modelManager.getActiveModelIdentifier() || model.id || requestedModel || await this.modelManager.getModelId();

            const craftedPrompt = messages.map((msg: ChatMessage, index: number) =>
                this.modelManager.createChatMessage(msg, index)
            );

            const cancellationTokenSource = new vscode.CancellationTokenSource();
            const chatResponse = await model.sendRequest(craftedPrompt, {}, cancellationTokenSource.token);

            if (!chatResponse) {
                throw new Error('No response from language model');
            }

            let promptTokens = 0;
            for (const msg of messages) {
                promptTokens += await this.modelManager.countTokens(model, msg.content);
            }

            if (stream) {
                const responseId = this.responseFormatter.generateResponseId();
                const streamHandler = new ResponsesStreamHandler(
                    res,
                    modelId,
                    responseId,
                    this.logger,
                    this.responseFormatter,
                    model,
                    this.modelManager
                );

                streamHandler.initializeStream();
                await streamHandler.handleStream(chatResponse, promptTokens, instructionText || null);
                return;
            }

            let responseText = '';
            for await (const fragment of chatResponse.text) {
                responseText += fragment;
            }

            const completionTokens = await this.modelManager.countTokens(model, responseText);
            const responseId = this.responseFormatter.generateResponseId();
            const payload = this.responseFormatter.createResponsesResponse(
                responseId,
                modelId,
                responseText,
                promptTokens,
                completionTokens,
                'completed',
                instructionText || null
            );

            res.json(payload);
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private buildMessages(input: unknown, instructionText: string, fallbackMessages: unknown): ChatMessage[] {
        const messages: ChatMessage[] = [];

        if (instructionText) {
            messages.push({ role: 'system', content: instructionText });
        }

        if (input !== undefined && input !== null) {
            const parsed = this.parseInput(input);
            messages.push(...parsed);
        }

        if (Array.isArray(fallbackMessages)) {
            messages.push(...this.parseMessagesArray(fallbackMessages));
        }

        return messages;
    }

    private parseInput(input: unknown): ChatMessage[] {
        if (typeof input === 'string') {
            return [{ role: 'user', content: input }];
        }

        if (Array.isArray(input)) {
            return this.parseMessagesArray(input);
        }

        if (typeof input === 'object' && input !== null) {
            return this.parseMessagesArray([input as Record<string, unknown>]);
        }

        return [];
    }

    private parseMessagesArray(messages: unknown[]): ChatMessage[] {
        const parsed: ChatMessage[] = [];

        for (const message of messages) {
            if (!message || typeof message !== 'object') {
                continue;
            }

            const role = this.normalizeRole((message as Record<string, unknown>).role);
            const content = this.extractText((message as Record<string, unknown>).content);

            if (!content) {
                continue;
            }

            parsed.push({ role, content });
        }

        return parsed;
    }

    private extractText(content: unknown): string {
        if (typeof content === 'string') {
            return content;
        }

        if (typeof content === 'number' || typeof content === 'boolean') {
            return String(content);
        }

        if (Array.isArray(content)) {
            const parts = content
                .map(part => this.extractText(part))
                .filter(part => part.length > 0);
            return parts.join('');
        }

        if (typeof content === 'object' && content !== null) {
            const record = content as Record<string, unknown>;
            if (typeof record.text === 'string') {
                return record.text;
            }

            if (Array.isArray(record.content)) {
                return this.extractText(record.content);
            }
        }

        return '';
    }

    private normalizeRole(role: unknown): ChatMessage['role'] {
        if (typeof role !== 'string') {
            return 'user';
        }

        const normalized = role.toLowerCase();
        switch (normalized) {
            case 'system':
            case 'assistant':
            case 'user':
                return normalized;
            case 'developer':
            case 'tool':
                return 'system';
            default:
                return 'user';
        }
    }

    private handleError(res: Response, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.log(`Error in responses API: ${errorMessage}`);
        console.error('Error generating responses API result:', error);

        const statusCode = errorMessage.includes('No input provided') ? 400 : 500;
        res.status(statusCode).json(this.responseFormatter.createErrorResponse(error));
    }
}
