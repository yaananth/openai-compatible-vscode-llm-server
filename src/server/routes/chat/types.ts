import { ChatMessage } from '../../../config/types';

export interface ChatCompletionRequest {
    messages: ChatMessage[];
    stream?: boolean;
    model?: string;
}

export interface ChatCompletionChoice {
    index: number;
    message?: {
        role: string;
        content: string;
    };
    delta?: {
        role?: string;
        content?: string;
    };
    finish_reason?: string;
}

export interface ChatCompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface StreamChunk extends ChatCompletionResponse {
    object: 'chat.completion.chunk';
}

export interface ErrorResponse {
    error: {
        message: string;
        type: string;
    };
}
