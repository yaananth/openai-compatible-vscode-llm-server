import * as vscode from 'vscode';
import express from 'express';
import { Server } from 'http';

let server: Server | undefined;

export function activate(context: vscode.ExtensionContext) {
	const app = express();
	app.use(express.json());

	// Default port - could be made configurable through settings
	const port = 3000;

	// Models endpoint
	app.get('/v1/models', (req, res) => {
		res.json({
			object: 'list',
			data: [
				{
					id: 'claude-3.5-sonnet',
					object: 'model',
					created: 1677610602,
					owned_by: 'copilot',
				},
				{
					id: 'gpt-4o',
					object: 'model',
					created: 1687882412,
					owned_by: 'copilot',
				},
				{
					id: 'gpt-4o-mini',
					object: 'model',
					created: 1687882412,
					owned_by: 'copilot',
				},
				{
					id: 'o3-mini',
					object: 'model',
					created: 1687882412,
					owned_by: 'copilot',
				},
				{
					id: 'o1',
					object: 'model',
					created: 1687882412,
					owned_by: 'copilot',
				}
			]
		});
	});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream = false } = req.body;

  // Set headers for SSE if streaming is requested
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  try {
    // Convert messages to VSCode chat format
    const craftedPrompt = messages.map((msg: any) => {
      return msg.role === 'user' 
        ? vscode.LanguageModelChatMessage.User(msg.content)
        : vscode.LanguageModelChatMessage.Assistant(msg.content);
    });

    // Select model with vendor filter
    const modelId = req.body.model || 'gpt-4o';
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelId });
    let chatResponse: vscode.LanguageModelChatResponse | undefined = await model.sendRequest(craftedPrompt, {}, new vscode.CancellationTokenSource().token);

    if (!chatResponse) {
      throw new Error('No response from language model');
    }

    if (stream) {
      // Send initial response
      const initialResponse = {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'vscode-llm',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant'
            }
          }
        ]
      };
      res.write(`data: ${JSON.stringify(initialResponse)}\n\n`);

      try {
        // Stream each fragment
        for await (const fragment of chatResponse.text) {
          const chunk = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'vscode-llm',
            choices: [
              {
                index: 0,
                delta: {
                  content: fragment
                }
              }
            ]
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // Send final [DONE] message
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        // Handle streaming errors
        const errorChunk = {
          error: {
            message: error instanceof Error ? error.message : 'Stream interrupted',
            type: 'server_error'
          }
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response
      let responseText = '';
      for await (const fragment of chatResponse.text) {
        responseText += fragment;
      }

      res.json({
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'vscode-llm',
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
          prompt_tokens: 0, // Token counting not supported
          completion_tokens: 0,
          total_tokens: 0
        }
      });
    }
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({
      error: {
        message: 'Error generating response from language model',
        type: 'internal_server_error'
      }
    });
  }
});

	// Start the server
	server = app.listen(port, () => {
		vscode.window.showInformationMessage(`OpenAI compatible server running on http://localhost:${port}`);
	});

	// Register a command to get server status
	let disposable = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.status', () => {
		vscode.window.showInformationMessage(`Server is running on http://localhost:${port}`);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {
  if (server) {
    server.close();
    vscode.window.showInformationMessage('OpenAI compatible server stopped');
  }
}
