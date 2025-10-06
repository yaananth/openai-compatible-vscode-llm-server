import { strict as assert } from 'assert';
const mock = require('mock-require');
mock('vscode', {});

const { ResponseFormatter } = require('../src/server/routes/chat/response-formatter');
const { ResponsesStreamHandler } = require('../src/server/routes/responses/stream-handler');

describe('ResponsesStreamHandler', () => {
    it('emits OpenAI Responses streaming events in spec order', async () => {
        const writes: string[] = [];
        const headers: Record<string, string> = {};
        let ended = false;
        const res = {
            setHeader: (key: string, value: string) => {
                headers[key] = value;
            },
            write: (chunk: string) => {
                writes.push(chunk);
            },
            end: () => {
                ended = true;
            }
        } as any;

        const formatter = new ResponseFormatter();
        const logger = { log: () => {} } as any;
        const modelManager = {
            countTokens: async (_model: unknown, text: string) => text.length
        };

        const handler = new ResponsesStreamHandler(
            res,
            'gpt-5-codex-high',
            'resp_test_stream',
            logger,
            formatter,
            {} as any,
            modelManager as any,
            true,
            'auto'
        );

        handler.initializeStream();

        const fragments = ['Hello', '.'];
        const chatResponse = {
            text: (async function* () {
                for (const frag of fragments) {
                    yield frag;
                }
            })()
        } as any;

        await handler.handleStream(chatResponse, 10, 'system instructions', { meta: 'true' });

        assert.equal(headers['Content-Type'], 'text/event-stream; charset=utf-8');
        assert(ended, 'response should end');

        const blocks = writes.join('');
        const events = blocks
            .trim()
            .split('\n\n')
            .filter(block => block.startsWith('event: '))
            .map(block => {
                const [eventLine, dataLine] = block.split('\n');
                return {
                    event: eventLine.replace('event: ', '').trim(),
                    dataLine: dataLine.replace('data: ', '').trim()
                };
            });

        const eventNames = events.map(b => b.event);
        assert.deepEqual(eventNames, [
            'response.created',
            'response.in_progress',
            'response.output_item.added', // reasoning added
            'response.output_item.done',  // reasoning done
            'response.output_item.added', // message added
            'response.content_part.added',
            'response.output_text.delta',
            'response.output_text.delta',
            'response.output_text.done',
            'response.content_part.done',
            'response.output_item.done',
            'response.completed'
        ]);

        const createdPayload = JSON.parse(events[0].dataLine);
        assert.equal(createdPayload.response.instructions, 'system instructions');
        assert.deepEqual(createdPayload.response.metadata, { meta: 'true' });
        assert.equal(createdPayload.response.tool_choice, 'auto');
        assert.deepEqual(createdPayload.response.tools, []);

        const deltaPayload = JSON.parse(events[6].dataLine);
        assert.equal(deltaPayload.delta, 'Hello');
        assert.equal(deltaPayload.output_index, 1);
        const expectedObfuscation = Buffer.from(`Hello:${deltaPayload.sequence_number}`).toString('base64');
        assert.equal(deltaPayload.obfuscation, expectedObfuscation);

        const donePayload = JSON.parse(events[8].dataLine);
        assert.equal(donePayload.text, 'Hello.');

        const completedPayload = JSON.parse(events[11].dataLine);
        assert.equal(completedPayload.response.status, 'completed');
        assert.equal(completedPayload.response.tool_choice, 'auto');
        assert.deepEqual(completedPayload.response.tools, []);
        assert.equal(completedPayload.response.output_text, 'Hello.');
        assert.equal(completedPayload.response.usage.total_tokens, 'Hello.'.length + 10);
    });
});
