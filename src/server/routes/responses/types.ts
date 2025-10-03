export type ResponseStatus = 'completed' | 'failed' | 'in_progress' | 'incomplete';

export interface ResponseUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
}

export interface ResponseContentPart {
    type: 'output_text';
    text: string;
    annotations: unknown[];
}

export interface ResponseOutputItem {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ResponseContentPart[];
}

export interface ResponsesResponse {
    id: string;
    object: 'response';
    created_at: number;
    model: string;
    status: ResponseStatus;
    output: ResponseOutputItem[];
    output_text: string;
    usage: ResponseUsage;
    instructions: string | null;
    metadata: Record<string, unknown> | null;
}
