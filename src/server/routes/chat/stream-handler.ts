import * as vscode from 'vscode';
import { Response } from 'express';
import { Logger } from '../../../utils/logger';
import { ResponseFormatter } from './response-formatter';
import { ModelManager } from './model-manager';

export class StreamHandler {
    constructor(
        private res: Response,
        private modelId: string,
        private logger: Logger,
        private responseFormatter: ResponseFormatter,
        private model: vscode.LanguageModelChat,
        private modelManager: ModelManager
    ) {}

    initializeStream(): void {
        this.res.setHeader('Content-Type', 'text/event-stream');
        this.res.setHeader('Cache-Control', 'no-cache');
        this.res.setHeader('Connection', 'keep-alive');

        const initialChunk = this.responseFormatter.createStreamChunk(this.modelId, undefined, true);
        this.writeChunk(initialChunk);
    }

    private writeChunk(chunk: any): void {
        this.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    async handleStream(
        chatResponse: vscode.LanguageModelChatResponse,
        promptTokens: number
    ): Promise<void> {
        this.logger.log('Starting streaming response');
        let responseTextAll = '';

        try {
            const iterator = chatResponse.text[Symbol.asyncIterator]();
            let result;
            
            while ((result = await iterator.next())) {
                const fragment = result.value;
                responseTextAll += fragment;
                const isLast = result.done;

                if (isLast) {
                    await this.handleFinalChunks(responseTextAll, promptTokens);
                    break;
                }

                const chunk = this.responseFormatter.createStreamChunk(this.modelId, fragment);
                this.writeChunk(chunk);
            }

            this.res.write('data: [DONE]\n\n');
            this.res.end();
        } catch (error) {
            await this.handleStreamError(error);
        }
    }

    private async handleFinalChunks(responseTextAll: string, promptTokens: number): Promise<void> {
        const completionTokens = await this.modelManager.countTokens(this.model, responseTextAll);

        const emptyChunk = this.responseFormatter.createStreamChunk(this.modelId);
        this.writeChunk(emptyChunk);

        const finalChunk = this.responseFormatter.createStreamChunk(
            this.modelId,
            undefined,
            false,
            true,
            {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens
            }
        );
        this.writeChunk(finalChunk);
    }

    private async handleStreamError(error: unknown): Promise<void> {
        if (error instanceof Error) {
            this.logger.log(`Streaming error: ${error.message}`);
            this.logger.log(`Stack trace: ${error.stack}`);
        } else {
            this.logger.log('Unknown streaming error');
        }

        try {
            const errorChunk = this.responseFormatter.createErrorResponse(error);
            this.writeChunk(errorChunk);
        } catch (writeError) {
            this.logger.log(`Failed to write error response: ${writeError instanceof Error ? writeError.message : 'Unknown write error'}`);
        } finally {
            this.res.end();
        }
    }
}
