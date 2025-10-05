import { ChatCompletionResponse, StreamChunk, ErrorResponse } from './types';
import { ResponsesResponse, ResponseOutputItem, ResponseStatus } from '../responses/types';

export class ResponseFormatter {
    private generateMessageId(): string {
        return `msg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    }

    createResponseEnvelope(
        responseId: string,
        modelId: string,
        status: 'in_progress' | 'completed' | 'failed' | 'incomplete',
        promptTokens: number,
        completionTokens: number,
        instructions?: string | null,
        metadata?: Record<string, unknown> | null,
        options?: {
            createdAt?: number;
            outputText?: string;
            outputId?: string;
            includeOutput?: boolean;
            outputItems?: Array<Record<string, unknown>>;
        }
    ): Record<string, unknown> {
        const createdAt = options?.createdAt ?? Math.floor(Date.now() / 1000);
        const outputText = options?.outputText ?? '';
        const includeOutput = options?.includeOutput ?? true;
        const outputId = options?.outputId ?? this.generateMessageId();

        const outputItems = options?.outputItems;

        const response: Record<string, unknown> = {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status,
            background: false,
            error: null,
            incomplete_details: null,
            model: modelId,
            output: includeOutput
                ? [
                    {
                        id: outputId,
                        type: 'message',
                        role: 'assistant',
                        content: [
                            {
                                type: 'output_text',
                                text: outputText,
                                annotations: []
                            }
                        ]
                    }
                ]
                : [],
            output_text: includeOutput ? outputText : '',
            usage: includeOutput
                ? {
                    input_tokens: promptTokens,
                    output_tokens: completionTokens,
                    total_tokens: promptTokens + completionTokens
                }
                : null,
            user: null,
            metadata: metadata ?? {}
        };

        response.instructions = instructions ?? '';

        if (outputItems && includeOutput) {
            response.output = outputItems;
            if (outputItems.length > 0) {
                const messageItem = outputItems.find(item => (item as { type?: string }).type === 'message');
                if (messageItem) {
                    const text = (messageItem as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
                    response.output_text = text;
                }
            }
        }

        return response;
    }

    createChatCompletionResponse(
        modelId: string,
        responseText: string,
        promptTokens: number,
        completionTokens: number
    ): ChatCompletionResponse {
        return {
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
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens
            }
        };
    }

    createStreamChunk(
        modelId: string,
        fragment?: string,
        isInitial: boolean = false,
        isFinal: boolean = false,
        usage?: { prompt_tokens: number; completion_tokens: number }
    ): StreamChunk {
        const chunk: StreamChunk = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
                index: 0,
                delta: isInitial ? { role: 'assistant' } : fragment ? { content: fragment } : {}
            }]
        };

        if (isFinal) {
            chunk.choices[0].finish_reason = 'stop';
            if (usage) {
                chunk.usage = {
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    total_tokens: usage.prompt_tokens + usage.completion_tokens
                };
            }
        }

        return chunk;
    }

    createResponsesResponse(
        responseId: string,
        modelId: string,
        responseText: string,
        promptTokens: number,
        completionTokens: number,
        status: ResponseStatus = 'completed',
        instructions: string | null = null,
        metadata: Record<string, unknown> | null = null,
        options?: { createdAt?: number; outputId?: string; outputItems?: Array<Record<string, unknown>> }
    ): ResponsesResponse {
        const response = this.createResponseEnvelope(
            responseId,
            modelId,
            status,
            promptTokens,
            completionTokens,
            instructions,
            metadata,
            {
                createdAt: options?.createdAt,
                outputText: responseText,
                outputId: options?.outputId,
                includeOutput: true,
                outputItems: options?.outputItems
            }
        ) as unknown as ResponsesResponse;

        return response;
    }

    createErrorResponse(error: unknown): ErrorResponse {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            error: {
                message: errorMessage,
                type: 'server_error'
            }
        };
    }

    generateResponseId(): string {
        return `resp_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    }
}
