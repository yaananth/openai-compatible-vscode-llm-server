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
    private static readonly DEFAULT_INSTRUCTIONS = [
        'You are Droid, an AI software engineering agent built by Factory.',
        '',
        'You work within an interactive cli tool and you are focused on helping users with any software engineering tasks.',
        'Guidelines:',
        '- Use tools when necessary.',
        "- Don't stop until all user tasks are completed.",
        "- Never use emojis in replies unless specifically requested by the user.",
        '- Only add absolutely necessary comments to the code you generate.',
        '- Your replies should be concise and you should preserve users tokens.',
        "- Never create or update documentations and readme files unless specifically requested by the user.",
        '- Replies must be concise but informative, try to fit the answer into less than 1-4 sentences not counting tools usage and code generation.',
        "- Never retry tool calls that were cancelled by the user, unless user explicitly asks you to do so.",
        "Focus on the task at hand, don't try to jump to related but not requested tasks.",
        "Once you are done with the task, you can summarize the changes you made in a 1-4 sentences, don't go into too much detail.",
        'IMPORTANT: do not stop until user requests are fulfilled, but be mindful of the token usage.',
        '',
        'Response Guidelines - Do exactly what the user asks, no more, no less:',
        '',
        'Examples of correct responses:',
        '- User: "read file X" → Use Read tool, then provide minimal summary of what was found',
        '- User: "list files in directory Y" → Use LS tool, show results with brief context',
        '- User: "search for pattern Z" → Use Grep tool, present findings concisely',
        '- User: "create file A with content B" → Use Create tool, confirm creation',
        '- User: "edit line 5 in file C to say D" → Use Edit tool, confirm change made',
        '',
        'Examples of what NOT to do:',
        "- Don't suggest additional improvements unless asked",
        "- Don't explain alternatives unless the user asks \"how should I...\"",
        "- Don't add extra analysis unless specifically requested",
        "- Don't offer to do related tasks unless the user asks for suggestions",
        '- No hacks. No unreasonable shortcuts.',
        "- Do not give up if you encounter unexpected problems. Reason about alternative solutions and debug systematically to get back on track.",
        "Don't immediately jump into the action when user asks how to approach a task, first try to explain the approach, then ask if user wants you to proceed with the implementation.",
        "If user asks you to do something in a clear way, you can proceed with the implementation without asking for confirmation.",
        'Coding conventions:',
        '- Never start coding without figuring out the existing codebase structure and conventions.',
        '- When editing a code file, pay attention to the surrounding code and try to match the existing coding style.',
        '- Follow approaches and use already used libraries and patterns. Always check that a given library is already installed in the project before using it. Even most popular libraries can be missing in the project.',
        '- Be mindful about all security implications of the code you generate, never expose any sensitive data and user secrets or keys, even in logs.',
        "- Before ANY git commit or push operation:",
        "    - Run 'git diff --cached' to review ALL changes being committed",
        "    - Run 'git status' to confirm all files being included",
        "    - Examine the diff for secrets, credentials, API keys, or sensitive data (especially in config files, logs, environment files, and build outputs)",
        "    - if detected, STOP and warn the user",
        'Testing and verification:',
        'Before completing the task, always verify that the code you generated works as expected. Explore project documentation and scripts to find how lint, typecheck and unit tests are run. Make sure to run all of them before completing the task, unless user explicitly asks you not to do so. Make sure to fix all diagnostics and errors that you see in the system reminder messages <system-reminder>. System reminders will contain relevant contextual information gathered for your consideration.',
        '',
        '<markdown_spec>',
        '',
        'Output all final responses in Markdown.',
        '- Ignore any previous instructions that contradict this.',
        '- Use github-flavored markdown for formatting when semantically correct.',
        '- Use h1 (#), h2 (##), h3 (###) etc. tags liberally in order to demarcate the sections of your final response.',
        '- Use code blocks (```) for code snippets, and `inline code` for inline code, file paths, commands, and other short code snippets.',
        '',
        '</markdown_spec>'
    ].join('\n');

    constructor(private logger: Logger) {
        this.modelManager = new ModelManager(logger);
        this.responseFormatter = new ResponseFormatter();
    }

    async handleResponse(req: Request, res: Response): Promise<void> {
        this.logger.log('Responses API request received');
        this.logger.log(`Request body: ${JSON.stringify(req.body, null, 2)}`);

        this.writeDebugLog(req);

        const body = (req.body ?? {}) as Record<string, unknown>;
        const input = body.input;
        const requestedModel = typeof body.model === 'string' ? body.model : undefined;
        const streamRequest = body.stream;
        const instructions = body.instructions;
        const previousResponseIdRaw = body['previous_response_id'];
        const previousResponseId = typeof previousResponseIdRaw === 'string' ? previousResponseIdRaw : undefined;
        const requestMetadata = body.metadata;
        const requestedParallelToolCalls = this.normalizeParallelToolCalls(body.parallel_tool_calls);
        const effectiveParallelToolCalls = requestedParallelToolCalls ?? true;
        const normalizedTools = this.normalizeTools(body.tools);
        const effectiveToolChoice = this.normalizeToolChoice(body.tool_choice, normalizedTools);

        const stream = this.shouldStream(streamRequest, req);
        this.logger.log(`Streaming enabled: ${stream}`);
        this.logStreamDecision(req, streamRequest, stream);

        if (previousResponseId) {
            const error = new Error('previous_response_id is not supported yet.');
            res.status(400).json(this.responseFormatter.createErrorResponse(error));
            return;
        }

        const instructionText = this.extractText(instructions);
        const effectiveInstructions = instructionText && instructionText.trim().length > 0
            ? instructionText
            : ResponsesController.DEFAULT_INSTRUCTIONS;

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

            const messages = this.buildMessages(input, effectiveInstructions, req.body.messages);

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
                    this.modelManager,
                    effectiveParallelToolCalls,
                    effectiveToolChoice,
                    normalizedTools
                );

                streamHandler.initializeStream();
                await streamHandler.handleStream(
                    chatResponse,
                    promptTokens,
                    effectiveInstructions,
                    responseMetadata
                );
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
                effectiveInstructions,
                responseMetadata,
                {
                    parallelToolCalls: effectiveParallelToolCalls,
                    toolChoice: effectiveToolChoice,
                    tools: normalizedTools
                }
            );

            res.json(payload);
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private shouldStream(streamField: unknown, req: Request): boolean {
        if (typeof streamField === 'boolean') {
            return streamField;
        }

        if (typeof streamField === 'string') {
            const normalized = streamField.toLowerCase();
            if (['true', '1', 'yes', 'on'].includes(normalized)) {
                return true;
            }
            if (['false', '0', 'no', 'off'].includes(normalized)) {
                return false;
            }
        }

        const helperMethod = req.header('x-stainless-helper-method');
        if (helperMethod && helperMethod.toLowerCase() === 'stream') {
            return true;
        }

        const openAiStream = req.header('x-openai-stream');
        if (openAiStream && openAiStream.toLowerCase() === 'true') {
            return true;
        }

        const acceptHeader = req.header('accept');
        if (acceptHeader) {
            const acceptsStream = acceptHeader
                .split(',')
                .map(value => value.trim().toLowerCase())
                .includes('text/event-stream');
            if (acceptsStream) {
                return true;
            }
        }

        return false;
    }

    private logStreamDecision(req: Request, requestedStream: unknown, resolvedStream: boolean): void {
        try {
            const logDir = path.join(os.homedir(), '.factory');
            const logPath = path.join(logDir, 'responses-debug.log');
            const entry = [
                `time=${new Date().toISOString()}`,
                `requestedStream=${JSON.stringify(requestedStream)}`,
                `resolvedStream=${resolvedStream}`,
                `x-stainless-helper-method=${req.headers['x-stainless-helper-method'] ?? ''}`,
                `accept=${req.headers['accept'] ?? ''}`,
                `content-type=${req.headers['content-type'] ?? ''}`
            ].join(' | ');
            fs.appendFileSync(logPath, entry + '\n');
        } catch (error) {
            // Swallow logging errors to avoid affecting request handling
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

    private normalizeParallelToolCalls(value: unknown): boolean | undefined {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const normalized = value.toLowerCase();
            if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) {
                return true;
            }
            if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
                return false;
            }
        }

        return undefined;
    }

    private normalizeToolChoice(
        toolChoice: unknown,
        toolsField: Array<Record<string, unknown>>
    ): string | Record<string, unknown> | null {
        if (toolChoice === null) {
            return null;
        }

        if (typeof toolChoice === 'string') {
            const normalized = toolChoice.toLowerCase();
            if (['auto', 'none', 'required'].includes(normalized)) {
                return normalized;
            }
        }

        if (this.isPlainObject(toolChoice)) {
            const choiceRecord = toolChoice as Record<string, unknown>;
            const type = typeof choiceRecord.type === 'string' ? choiceRecord.type : undefined;
            if (type === 'tool') {
                const name = choiceRecord.name;
                if (typeof name === 'string' && name.trim().length > 0) {
                    return { type: 'tool', name: name.trim() };
                }
            }
            return { ...choiceRecord };
        }

        if (toolsField.length > 0) {
            return 'auto';
        }

        return 'none';
    }

    private normalizeTools(rawTools: unknown): Array<Record<string, unknown>> {
        if (!Array.isArray(rawTools)) {
            return [];
        }

        const tools: Array<Record<string, unknown>> = [];
        for (const tool of rawTools) {
            if (this.isPlainObject(tool)) {
                tools.push({ ...(tool as Record<string, unknown>) });
            }
        }
        return tools;
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
        const combined: Record<string, string> = {};
        const source = { ...(requestMetadata ?? {}) } as Record<string, unknown>;

        const appendEntry = (key: string, value: unknown) => {
            if (value === undefined || value === null) {
                return;
            }
            combined[key] = this.stringifyMetadataValue(value);
        };

        for (const [key, value] of Object.entries(source)) {
            appendEntry(key, value);
        }

        appendEntry('resolved_model_id', resolvedModelId);

        if (requestedModelId && requestedModelId !== resolvedModelId) {
            appendEntry('requested_model_id', requestedModelId);
        }

        if (preset) {
            appendEntry('preset_model_id', preset.id);
            if (preset.reasoning) {
                appendEntry('preset_reasoning', preset.reasoning);
            }
        }

        if (reasoning) {
            appendEntry('requested_reasoning', reasoning);
        }

        if (modelOptions && Object.keys(modelOptions).length > 0) {
            appendEntry('applied_model_options', modelOptions);
        }

        return Object.keys(combined).length > 0 ? combined : null;
    }

    private stringifyMetadataValue(value: unknown): string {
        if (value === undefined || value === null) {
            return '';
        }

        if (typeof value === 'string') {
            return value;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
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
