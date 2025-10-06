import * as vscode from 'vscode';
import { Response } from 'express';
import { Logger } from '../../../utils/logger';
import { ResponseFormatter } from '../chat/response-formatter';
import { ModelManager } from '../chat/model-manager';

export class ResponsesStreamHandler {
    private sequenceNumber = 0;
    private createdAt = Math.floor(Date.now() / 1000);
    private messageItemId = '';
    private reasoningItemId = '';

    constructor(
        private res: Response,
        private modelId: string,
        private responseId: string,
        private logger: Logger,
        private responseFormatter: ResponseFormatter,
        private model: vscode.LanguageModelChat,
        private modelManager: ModelManager,
        private readonly parallelToolCalls: boolean
    ) {}

    initializeStream(): void {
        this.sequenceNumber = 0;
        this.createdAt = Math.floor(Date.now() / 1000);
        this.messageItemId = this.generateMessageId();
        this.reasoningItemId = `rs_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
        this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        this.res.setHeader('X-Accel-Buffering', 'no');
        this.res.setHeader('Cache-Control', 'no-cache');
        this.res.setHeader('Connection', 'keep-alive');

        if (typeof (this.res as Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
            (this.res as Response & { flushHeaders?: () => void }).flushHeaders();
        }
    }

    private writeEvent(event: string, data: unknown): void {
        this.res.write(`event: ${event}\n`);
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        this.res.write(`data: ${payload}\n\n`);
    }

    private nextSequence(): number {
        return this.sequenceNumber++;
    }

    private generateMessageId(): string {
        return `msg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    }

    private generateObfuscation(fragment: string, sequence: number): string {
        const source = `${fragment}:${sequence}`;
        return Buffer.from(source).toString('base64');
    }

    async handleStream(
        chatResponse: vscode.LanguageModelChatResponse,
        promptTokens: number,
        instructions: string | null,
        metadata: Record<string, unknown> | null
    ): Promise<void> {
        this.logger.log('Starting responses streaming');
        let responseText = '';

        try {
            const effectiveInstructions = instructions ?? '';

            const reasoningEncrypted = Buffer.from(`${effectiveInstructions}:${this.responseId}`).toString('base64');

            const createdEnvelope = this.responseFormatter.createResponseEnvelope(
                this.responseId,
                this.modelId,
                'in_progress',
                promptTokens,
                0,
                effectiveInstructions,
                metadata,
                {
                    createdAt: this.createdAt,
                    outputText: '',
                    outputId: this.messageItemId,
                    includeOutput: false,
                    parallelToolCalls: this.parallelToolCalls
                }
            );

            this.writeEvent('response.created', {
                type: 'response.created',
                sequence_number: this.nextSequence(),
                response: createdEnvelope
            });

            this.writeEvent('response.in_progress', {
                type: 'response.in_progress',
                sequence_number: this.nextSequence(),
                response: createdEnvelope
            });

            const reasoningItem = {
                id: this.reasoningItemId,
                type: 'reasoning',
                status: 'in_progress',
                encrypted_content: reasoningEncrypted,
                summary: [] as unknown[]
            };

            this.writeEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: this.nextSequence(),
                output_index: 0,
                item: reasoningItem
            });

            const reasoningCompletedItem = {
                ...reasoningItem,
                status: 'completed'
            };

            this.writeEvent('response.output_item.done', {
                type: 'response.output_item.done',
                sequence_number: this.nextSequence(),
                output_index: 0,
                item: reasoningCompletedItem
            });

            const messageItemBase = {
                id: this.messageItemId,
                type: 'message',
                status: 'in_progress',
                role: 'assistant',
                content: [] as unknown[]
            };

            this.writeEvent('response.output_item.added', {
                type: 'response.output_item.added',
                sequence_number: this.nextSequence(),
                output_index: 1,
                item: messageItemBase
            });

            const initialPart = {
                type: 'output_text',
                annotations: [] as unknown[],
                logprobs: [] as unknown[],
                text: ''
            };

            this.writeEvent('response.content_part.added', {
                type: 'response.content_part.added',
                sequence_number: this.nextSequence(),
                item_id: this.messageItemId,
                output_index: 1,
                content_index: 0,
                part: initialPart
            });

            for await (const fragment of chatResponse.text) {
                if (!fragment) {
                    continue;
                }

                responseText += fragment;
                const sequence = this.nextSequence();
                this.writeEvent('response.output_text.delta', {
                    type: 'response.output_text.delta',
                    sequence_number: sequence,
                    item_id: this.messageItemId,
                    output_index: 1,
                    content_index: 0,
                    delta: fragment,
                    logprobs: [] as unknown[],
                    obfuscation: this.generateObfuscation(fragment, sequence)
                });
            }

            this.writeEvent('response.output_text.done', {
                type: 'response.output_text.done',
                sequence_number: this.nextSequence(),
                item_id: this.messageItemId,
                output_index: 1,
                content_index: 0,
                text: responseText,
                logprobs: [] as unknown[]
            });

            const finalPart = {
                type: 'output_text',
                annotations: [] as unknown[],
                logprobs: [] as unknown[],
                text: responseText
            };

            const messageCompletedItem = {
                id: this.messageItemId,
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [finalPart]
            };

            this.writeEvent('response.content_part.done', {
                type: 'response.content_part.done',
                sequence_number: this.nextSequence(),
                item_id: this.messageItemId,
                output_index: 1,
                content_index: 0,
                part: finalPart
            });

            this.writeEvent('response.output_item.done', {
                type: 'response.output_item.done',
                sequence_number: this.nextSequence(),
                output_index: 1,
                item: messageCompletedItem
            });

            const completionTokens = await this.modelManager.countTokens(this.model, responseText);
            const completedEnvelope = this.responseFormatter.createResponseEnvelope(
                this.responseId,
                this.modelId,
                'completed',
                promptTokens,
                completionTokens,
                effectiveInstructions,
                metadata,
                {
                    createdAt: this.createdAt,
                    outputText: responseText,
                    outputId: this.messageItemId,
                    includeOutput: true,
                    outputItems: [reasoningCompletedItem, messageCompletedItem],
                    parallelToolCalls: this.parallelToolCalls
                }
            );

            this.writeEvent('response.completed', {
                type: 'response.completed',
                sequence_number: this.nextSequence(),
                response: completedEnvelope
            });
            this.res.end();
        } catch (error) {
            this.logger.log(`Responses streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            const errorPayload = this.responseFormatter.createErrorResponse(error);
            this.writeEvent('error', errorPayload);
            this.res.end();
        }
    }
}
