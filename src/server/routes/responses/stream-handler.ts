import * as vscode from 'vscode';
import { Response } from 'express';
import { Logger } from '../../../utils/logger';
import { ResponseFormatter } from '../chat/response-formatter';
import { ModelManager } from '../chat/model-manager';

export class ResponsesStreamHandler {
    constructor(
        private res: Response,
        private modelId: string,
        private responseId: string,
        private logger: Logger,
        private responseFormatter: ResponseFormatter,
        private model: vscode.LanguageModelChat,
        private modelManager: ModelManager
    ) {}

    initializeStream(): void {
        this.res.setHeader('Content-Type', 'text/event-stream');
        this.res.setHeader('Cache-Control', 'no-cache');
        this.res.setHeader('Connection', 'keep-alive');

        const createdPayload = {
            id: this.responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            model: this.modelId,
            status: 'in_progress'
        };

        this.writeEvent('response.created', createdPayload);
    }

    private writeEvent(event: string, data: unknown): void {
        this.res.write(`event: ${event}\n`);
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        this.res.write(`data: ${payload}\n\n`);
    }

    async handleStream(
        chatResponse: vscode.LanguageModelChatResponse,
        promptTokens: number,
        instructions: string | null
    ): Promise<void> {
        this.logger.log('Starting responses streaming');
        let responseText = '';
        const outputId = `${this.responseId}-msg-0`;

        try {
            for await (const fragment of chatResponse.text) {
                if (!fragment) {
                    continue;
                }

                responseText += fragment;
                this.writeEvent('response.output_text.delta', {
                    id: outputId,
                    delta: fragment,
                    output_index: 0
                });
            }

            const completionTokens = await this.modelManager.countTokens(this.model, responseText);
            const finalPayload = this.responseFormatter.createResponsesResponse(
                this.responseId,
                this.modelId,
                responseText,
                promptTokens,
                completionTokens,
                'completed',
                instructions
            );

            this.writeEvent('response.completed', finalPayload);
            this.writeEvent('done', '[DONE]');
            this.res.end();
        } catch (error) {
            this.logger.log(`Responses streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            const errorPayload = this.responseFormatter.createErrorResponse(error);
            this.writeEvent('error', errorPayload);
            this.res.end();
        }
    }
}
