import { ChatCompletionResponse, StreamChunk, ErrorResponse } from './types';
import { ResponsesResponse, ResponseOutputItem, ResponseStatus } from '../responses/types';

export class ResponseFormatter {
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
        instructions: string | null = null
    ): ResponsesResponse {
        const output: ResponseOutputItem = {
            id: `${responseId}-msg-0`,
            type: 'message',
            role: 'assistant',
            content: [
                {
                    type: 'output_text',
                    text: responseText,
                    annotations: []
                }
            ]
        };

        return {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            model: modelId,
            status,
            output: [output],
            output_text: responseText,
            usage: {
                input_tokens: promptTokens,
                output_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens
            },
            instructions,
            metadata: null
        };
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
