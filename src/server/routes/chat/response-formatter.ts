import { ChatCompletionResponse, StreamChunk, ErrorResponse } from './types';

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

    createErrorResponse(error: unknown): ErrorResponse {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            error: {
                message: errorMessage,
                type: 'server_error'
            }
        };
    }
}
