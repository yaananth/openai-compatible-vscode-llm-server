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
					id: 'gpt-3.5-turbo',
					object: 'model',
					created: 1677610602,
					owned_by: 'openai',
				},
				{
					id: 'gpt-4o',
					object: 'model',
					created: 1687882412,
					owned_by: 'openai',
				}
			]
		});
	});

// Chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const { messages } = req.body;

  try {
    // Convert messages to VSCode chat format
    const craftedPrompt = messages.map((msg: any) => {
      return msg.role === 'user' 
        ? vscode.LanguageModelChatMessage.User(msg.content)
        : vscode.LanguageModelChatMessage.Assistant(msg.content);
    });

    // Select model with vendor filter
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    const responseText = await model.sendRequest(craftedPrompt, {});

    if (!responseText) {
      throw new Error('No response from language model');
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
