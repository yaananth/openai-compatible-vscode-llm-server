"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const response_formatter_1 = require("../src/server/routes/chat/response-formatter");
describe('ResponseFormatter', () => {
    const formatter = new response_formatter_1.ResponseFormatter();
    it('creates completed responses with usage and output metadata', () => {
        const response = formatter.createResponsesResponse('resp_test', 'gpt-5-codex-high', 'Hello world', 120, 3, 'completed', 'do things', { foo: 'bar' }, { createdAt: 1234, outputId: 'msg_custom' });
        assert_1.strict.equal(response.id, 'resp_test');
        assert_1.strict.equal(response.model, 'gpt-5-codex-high');
        assert_1.strict.equal(response.parallel_tool_calls, true);
        assert_1.strict.equal(response.status, 'completed');
        assert_1.strict.equal(response.instructions, 'do things');
        assert_1.strict.deepEqual(response.metadata, { foo: 'bar' });
        assert_1.strict.equal(response.created_at, 1234);
        assert_1.strict.equal(response.output_text, 'Hello world');
        assert_1.strict.equal(response.output[0].id, 'msg_custom');
        assert_1.strict.equal(response.output[0].content[0].text, 'Hello world');
        assert_1.strict.equal(response.text, 'Hello world');
        assert_1.strict.equal(response.usage.input_tokens, 120);
        assert_1.strict.equal(response.usage.output_tokens, 3);
        assert_1.strict.equal(response.usage.total_tokens, 123);
    });
    it('creates in-progress response envelope with empty output when requested', () => {
        const envelope = formatter.createResponseEnvelope('resp_env', 'gpt-5-codex', 'in_progress', 80, 0, 'stay ready', { a: 1 }, { createdAt: 5678, includeOutput: false });
        assert_1.strict.equal(envelope.id, 'resp_env');
        assert_1.strict.equal(envelope.status, 'in_progress');
        assert_1.strict.equal(envelope.parallel_tool_calls, true);
        assert_1.strict.equal(envelope.created_at, 5678);
        assert_1.strict.equal(envelope.output_text, '');
        assert_1.strict.equal(envelope.text, '');
        assert_1.strict.deepEqual(envelope.output, []);
        assert_1.strict.equal(envelope.usage, null);
        assert_1.strict.deepEqual(envelope.metadata, { a: 1 });
        assert_1.strict.equal(envelope.instructions, 'stay ready');
    });
    it('reflects output text and usage when includeOutput is true', () => {
        const envelope = formatter.createResponseEnvelope('resp_env_completed', 'gpt-5-codex', 'completed', 50, 10, null, null, { createdAt: 9012, outputText: 'Done', includeOutput: true });
        assert_1.strict.equal(envelope.created_at, 9012);
        assert_1.strict.equal(envelope.output_text, 'Done');
        assert_1.strict.equal(envelope.text, 'Done');
        assert_1.strict.equal(envelope.parallel_tool_calls, true);
        assert_1.strict.equal(envelope.instructions, '');
        const usage = envelope.usage;
        assert_1.strict.equal(usage.input_tokens, 50);
        assert_1.strict.equal(usage.output_tokens, 10);
        assert_1.strict.equal(usage.total_tokens, 60);
    });
});
//# sourceMappingURL=responseFormatter.test.js.map