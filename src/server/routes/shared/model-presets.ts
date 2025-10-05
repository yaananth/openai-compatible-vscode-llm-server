export type ReasoningEffort = 'low' | 'medium' | 'high' | 'default';
export type ReasoningSummary = 'off' | 'detailed' | 'default';

export interface ReasoningOptions {
    effort?: ReasoningEffort;
    summary?: ReasoningSummary;
    budget_tokens?: number;
}

export interface ModelPreset {
    id: string;
    baseModelIds: string[];
    reasoning?: ReasoningOptions;
    description: string;
    displayName: string;
}

const GPT5_BASE_IDS = ['gpt-5', 'openai/gpt-5'];
const GPT5_CODEX_BASE_IDS = ['gpt-5-codex', 'openai/gpt-5-codex'];

export const MODEL_PRESETS: ModelPreset[] = [
    {
        id: 'gpt-5-high',
        baseModelIds: GPT5_BASE_IDS,
        reasoning: { effort: 'high' },
        description: 'GPT-5 with reasoning effort preset to high.',
        displayName: 'GPT-5 (High Reasoning)'
    },
    {
        id: 'gpt-5-medium',
        baseModelIds: GPT5_BASE_IDS,
        reasoning: { effort: 'medium' },
        description: 'GPT-5 with reasoning effort preset to medium.',
        displayName: 'GPT-5 (Medium Reasoning)'
    },
    {
        id: 'gpt-5-low',
        baseModelIds: GPT5_BASE_IDS,
        reasoning: { effort: 'low' },
        description: 'GPT-5 with reasoning effort preset to low.',
        displayName: 'GPT-5 (Low Reasoning)'
    },
    {
        id: 'gpt-5-codex-high',
        baseModelIds: GPT5_CODEX_BASE_IDS,
        reasoning: { effort: 'high' },
        description: 'GPT-5 Codex with reasoning effort preset to high.',
        displayName: 'GPT-5 Codex (High Reasoning)'
    },
    {
        id: 'gpt-5-codex-medium',
        baseModelIds: GPT5_CODEX_BASE_IDS,
        reasoning: { effort: 'medium' },
        description: 'GPT-5 Codex with reasoning effort preset to medium.',
        displayName: 'GPT-5 Codex (Medium Reasoning)'
    },
    {
        id: 'gpt-5-codex-low',
        baseModelIds: GPT5_CODEX_BASE_IDS,
        reasoning: { effort: 'low' },
        description: 'GPT-5 Codex with reasoning effort preset to low.',
        displayName: 'GPT-5 Codex (Low Reasoning)'
    }
];

export function resolveModelPreset(modelId?: string): ModelPreset | undefined {
    if (!modelId) {
        return undefined;
    }
    const normalized = modelId.trim().toLowerCase();
    return MODEL_PRESETS.find(preset => preset.id.toLowerCase() === normalized);
}
