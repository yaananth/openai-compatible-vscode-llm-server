import { Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../../../utils/logger';
import { ModelManager } from '../chat/model-manager';
import { ResponseFormatter } from '../chat/response-formatter';
import { ChatMessage } from '../../../config/types';
import { ResponsesStreamHandler } from './stream-handler';
import { ModelPreset, ReasoningOptions, resolveModelPreset } from '../shared/model-presets';

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

        this.writeDebugLog(req);

        const {
            input,
            model: requestedModel,
            stream = false,
            instructions,
            previous_response_id: previousResponseId,
            metadata: requestMetadata
        } = req.body;

        if (previousResponseId) {
            const error = new Error('previous_response_id is not supported yet.');
            res.status(400).json(this.responseFormatter.createErrorResponse(error));
            return;
        }

        const instructionText = this.extractText(instructions);

        try {
            const preset = resolveModelPreset(requestedModel);
            if (preset) {
                this.logger.log(`Applying model preset "${preset.id}" targeting base ids: ${preset.baseModelIds.join(', ')}`);
            }

            const requestReasoning = this.extractReasoningOptions(req.body);
            const mergedReasoning = this.mergeReasoningOptions(preset?.reasoning, requestReasoning);
            if (mergedReasoning) {
                this.logger.log(`Applying reasoning options: ${JSON.stringify(mergedReasoning)}`);
            }

            const normalizedMetadata = this.normalizeMetadata(requestMetadata);
            const requestOptions = this.buildRequestOptions(mergedReasoning, req.body);
            if (requestOptions?.modelOptions) {
                this.logger.log(`Passing modelOptions to sendRequest: ${JSON.stringify(requestOptions.modelOptions)}`);
            }

            const messages = this.buildMessages(input, instructionText, req.body.messages);

            if (messages.length === 0) {
                throw new Error('No input provided. Supply `input` or `messages` with at least one entry.');
            }

            const model = await this.modelManager.getModel(requestedModel);
            const resolvedModelId = this.modelManager.getActiveModelIdentifier() || model.id || requestedModel || await this.modelManager.getModelId();
            const responseModelId = preset ? preset.id : resolvedModelId;

            const craftedPrompt = messages.map((msg: ChatMessage, index: number) =>
                this.modelManager.createChatMessage(msg, index)
            );

            const cancellationTokenSource = new vscode.CancellationTokenSource();
            const chatResponse = await model.sendRequest(craftedPrompt, requestOptions, cancellationTokenSource.token);

            if (!chatResponse) {
                throw new Error('No response from language model');
            }

            let promptTokens = 0;
            for (const msg of messages) {
                promptTokens += await this.modelManager.countTokens(model, msg.content);
            }

            const responseMetadata = this.buildResponseMetadata(
                normalizedMetadata,
                mergedReasoning,
                requestOptions?.modelOptions,
                preset,
                resolvedModelId,
                requestedModel
            );
            if (responseMetadata) {
                this.logger.log(`Response metadata prepared: ${JSON.stringify(responseMetadata)}`);
            }

            if (stream) {
                const responseId = this.responseFormatter.generateResponseId();
                const streamHandler = new ResponsesStreamHandler(
                    res,
                    responseModelId,
                    responseId,
                    this.logger,
                    this.responseFormatter,
                    model,
                    this.modelManager
                );

                streamHandler.initializeStream();
                await streamHandler.handleStream(chatResponse, promptTokens, instructionText || null, responseMetadata);
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
                responseModelId,
                responseText,
                promptTokens,
                completionTokens,
                'completed',
                instructionText || null,
                responseMetadata
            );

            res.json(payload);
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private writeDebugLog(req: Request): void {
        try {
            const logDir = path.join(os.homedir(), '.factory');
            const logPath = path.join(logDir, 'responses-debug.log');
            const entry = [
                `time=${new Date().toISOString()}`,
                `stream=${JSON.stringify(req.body?.stream)}`,
                `accept=${req.headers['accept'] ?? ''}`,
                `content-type=${req.headers['content-type'] ?? ''}`,
                `body=${JSON.stringify(req.body)}`
            ].join(' | ');
            fs.appendFileSync(logPath, entry + '\n');
        } catch (error) {
            // Swallow logging errors to avoid affecting request handling
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
            const parts: string[] = [];
            for (const part of content) {
                const text = this.extractText(part);
                if (text.length > 0) {
                    parts.push(text);
                }
            }
            return parts.join('\n');
        }

        if (this.isPlainObject(content)) {
            const record = content as Record<string, unknown>;
            const directText = this.extractTextFromContentObject(record);
            if (directText) {
                return directText;
            }
        }

        return '';
    }

    private extractTextFromContentObject(content: Record<string, unknown>): string | undefined {
        if (typeof content.text === 'string') {
            return content.text;
        }

        const type = typeof content.type === 'string' ? content.type : undefined;

        if (type === 'text' && typeof content.value === 'string') {
            return content.value;
        }

        if (type === 'input_text') {
            if (typeof content.input_text === 'string') {
                return content.input_text;
            }
            if (typeof content.content === 'string') {
                return content.content;
            }
        }

        if (type === 'output_text' && typeof content.output_text === 'string') {
            return content.output_text;
        }

        if (Array.isArray(content.content)) {
            const nested = this.extractText(content.content);
            return nested.length > 0 ? nested : undefined;
        }

        return undefined;
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

    private extractReasoningOptions(rawBody: unknown): ReasoningOptions | undefined {
        if (!this.isPlainObject(rawBody)) {
            return undefined;
        }

        const result: ReasoningOptions = {};
        const body = rawBody as Record<string, unknown>;
        const reasoning = body['reasoning'];

        if (this.isPlainObject(reasoning)) {
            const reasoningRecord = reasoning as Record<string, unknown>;
            const effort = this.normalizeReasoningEffort(reasoningRecord['effort']);
            if (effort) {
                result.effort = effort;
            }

            const summary = this.normalizeReasoningSummary(reasoningRecord['summary']);
            if (summary) {
                result.summary = summary;
            }

            const budget = this.normalizeReasoningBudget(
                reasoningRecord['budget_tokens'] ?? reasoningRecord['budgetTokens']
            );
            if (budget !== undefined) {
                result.budget_tokens = budget;
            }
        }

        const fallbackEffort = this.normalizeReasoningEffort(
            body['reasoning_effort'] ?? body['reasoningEffort']
        );
        if (fallbackEffort && result.effort === undefined) {
            result.effort = fallbackEffort;
        }

        const fallbackSummary = this.normalizeReasoningSummary(
            body['reasoning_summary'] ?? body['reasoningSummary']
        );
        if (fallbackSummary && result.summary === undefined) {
            result.summary = fallbackSummary;
        }

        const fallbackBudget = this.normalizeReasoningBudget(
            body['reasoning_budget_tokens'] ?? body['reasoningBudgetTokens']
        );
        if (fallbackBudget !== undefined && result.budget_tokens === undefined) {
            result.budget_tokens = fallbackBudget;
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    private mergeReasoningOptions(
        preset: ReasoningOptions | undefined,
        supplied: ReasoningOptions | undefined
    ): ReasoningOptions | undefined {
        if (!preset && !supplied) {
            return undefined;
        }

        const merged: ReasoningOptions = { ...(preset ?? {}) };

        if (supplied) {
            if (supplied.effort !== undefined) {
                merged.effort = supplied.effort;
            }
            if (supplied.summary !== undefined) {
                merged.summary = supplied.summary;
            }
            if (supplied.budget_tokens !== undefined) {
                merged.budget_tokens = supplied.budget_tokens;
            }
        }

        return Object.keys(merged).length > 0 ? merged : undefined;
    }

    private normalizeReasoningEffort(value: unknown): ReasoningOptions['effort'] | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const normalized = value.toLowerCase();
        const allowed: ReasoningOptions['effort'][] = ['low', 'medium', 'high', 'default'];
        return allowed.includes(normalized as ReasoningOptions['effort'])
            ? (normalized as ReasoningOptions['effort'])
            : undefined;
    }

    private normalizeReasoningSummary(value: unknown): ReasoningOptions['summary'] | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const normalized = value.toLowerCase();
        const allowed: ReasoningOptions['summary'][] = ['off', 'detailed', 'default'];
        return allowed.includes(normalized as ReasoningOptions['summary'])
            ? (normalized as ReasoningOptions['summary'])
            : undefined;
    }

    private normalizeReasoningBudget(value: unknown): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return undefined;
        }

        return Math.floor(value);
    }

    private buildRequestOptions(
        reasoning: ReasoningOptions | undefined,
        rawBody: unknown
    ): vscode.LanguageModelChatRequestOptions | undefined {
        const options: vscode.LanguageModelChatRequestOptions = {};

        if (reasoning) {
            options.modelOptions = { reasoning };
        }

        const justification = this.extractJustification(rawBody);
        if (justification) {
            options.justification = justification;
        }

        return Object.keys(options).length > 0 ? options : undefined;
    }

    private extractJustification(rawBody: unknown): string | undefined {
        if (!this.isPlainObject(rawBody)) {
            return undefined;
        }

        const value = (rawBody as Record<string, unknown>)['justification'];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
        }

        return undefined;
    }

    private normalizeMetadata(metadata: unknown): Record<string, unknown> | undefined {
        if (!this.isPlainObject(metadata)) {
            return undefined;
        }

        return { ...(metadata as Record<string, unknown>) };
    }

    private buildResponseMetadata(
        requestMetadata: Record<string, unknown> | undefined,
        reasoning: ReasoningOptions | undefined,
        modelOptions: { [name: string]: unknown } | undefined,
        preset: ModelPreset | undefined,
        resolvedModelId: string,
        requestedModelId?: string
    ): Record<string, unknown> | null {
        const combined: Record<string, unknown> = { ...(requestMetadata ?? {}) };

        combined.resolved_model_id = resolvedModelId;

        if (requestedModelId && requestedModelId !== resolvedModelId) {
            combined.requested_model_id = requestedModelId;
        }

        if (preset) {
            combined.preset_model_id = preset.id;
            if (preset.reasoning) {
                combined.preset_reasoning = preset.reasoning;
            }
        }

        if (reasoning) {
            combined.requested_reasoning = reasoning;
        }

        if (modelOptions && Object.keys(modelOptions).length > 0) {
            combined.applied_model_options = modelOptions;
        }

        return Object.keys(combined).length > 0 ? combined : null;
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private handleError(res: Response, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.log(`Error in responses API: ${errorMessage}`);
        console.error('Error generating responses API result:', error);

        const statusCode = errorMessage.includes('No input provided') ? 400 : 500;
        res.status(statusCode).json(this.responseFormatter.createErrorResponse(error));
    }
}
