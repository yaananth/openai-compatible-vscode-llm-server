import { strict as assert } from 'assert';
import { ResponseFormatter } from '../src/server/routes/chat/response-formatter';

describe('ResponseFormatter', () => {
    const formatter = new ResponseFormatter();

    it('creates completed responses with usage and output metadata', () => {
        const response = formatter.createResponsesResponse(
            'resp_test',
            'gpt-5-codex-high',
            'Hello world',
            120,
            3,
            'completed',
            'do things',
            { foo: 'bar' },
            { createdAt: 1234, outputId: 'msg_custom' }
        );

        assert.equal(response.id, 'resp_test');
        assert.equal(response.model, 'gpt-5-codex-high');
        assert.equal(response.parallel_tool_calls, true);
        assert.equal(response.tool_choice, 'none');
        assert.deepEqual(response.tools, []);
        assert.equal(response.status, 'completed');
        assert.equal(response.instructions, 'do things');
        assert.deepEqual(response.metadata, { foo: 'bar' });
        assert.equal(response.created_at, 1234);
        assert.equal(response.output_text, 'Hello world');
        assert.equal(response.output[0].id, 'msg_custom');
        assert.equal(response.output[0].content[0].text, 'Hello world');
        assert.deepEqual(response.text, {
            value: 'Hello world',
            annotations: [],
            format: { type: 'text' }
        });
        assert.equal(response.usage.input_tokens, 120);
        assert.equal(response.usage.output_tokens, 3);
        assert.equal(response.usage.total_tokens, 123);
    });

    it('creates in-progress response envelope with empty output when requested', () => {
        const envelope = (formatter as any).createResponseEnvelope(
            'resp_env',
            'gpt-5-codex',
            'in_progress',
            80,
            0,
            'stay ready',
            { a: 1 },
            { createdAt: 5678, includeOutput: false }
        ) as Record<string, unknown>;

        assert.equal(envelope.id, 'resp_env');
        assert.equal(envelope.status, 'in_progress');
        assert.equal(envelope.parallel_tool_calls, true);
        assert.equal((envelope as any).tool_choice, 'none');
        assert.deepEqual((envelope as any).tools, []);
        assert.equal(envelope.created_at, 5678);
        assert.equal(envelope.output_text, '');
        assert.deepEqual(envelope.text, {
            value: '',
            annotations: [],
            format: { type: 'text' }
        });
        assert.deepEqual(envelope.output, []);
        assert.equal(envelope.usage, null);
        assert.deepEqual(envelope.metadata, { a: 1 });
        assert.equal(envelope.instructions, 'stay ready');
    });

    it('reflects output text and usage when includeOutput is true', () => {
        const envelope = (formatter as any).createResponseEnvelope(
            'resp_env_completed',
            'gpt-5-codex',
            'completed',
            50,
            10,
            null,
            null,
            { createdAt: 9012, outputText: 'Done', includeOutput: true }
        ) as Record<string, unknown>;

        assert.equal(envelope.created_at, 9012);
        assert.equal(envelope.output_text, 'Done');
        assert.deepEqual(envelope.text, {
            value: 'Done',
            annotations: [],
            format: { type: 'text' }
        });
        assert.equal(envelope.parallel_tool_calls, true);
        assert.equal((envelope as any).tool_choice, 'none');
        assert.deepEqual((envelope as any).tools, []);
        assert.equal(envelope.instructions, '');
        const usage = envelope.usage as { input_tokens: number; output_tokens: number; total_tokens: number };
        assert.equal(usage.input_tokens, 50);
        assert.equal(usage.output_tokens, 10);
        assert.equal(usage.total_tokens, 60);
    });
    it('injects custom output items when provided', () => {
        const reasoning = { id: 'rs_1', type: 'reasoning', encrypted_content: 'enc', summary: [] };
        const message = {
            id: 'msg_1',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello', annotations: [], logprobs: [] }]
        };

        const response = formatter.createResponsesResponse(
            'resp_with_items',
            'gpt-5-codex-high',
            'hello',
            10,
            2,
            'completed',
            'inst',
            null,
            { createdAt: 42, outputId: 'msg_1', outputItems: [reasoning, message] }
        );

        assert.equal(response.output.length, 2);
        assert.deepEqual(response.output[0], reasoning);
        assert.equal((response.output[1] as any).id, 'msg_1');
    });
});
