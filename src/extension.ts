import * as vscode from 'vscode';
import express from 'express';
import { Server } from 'http';
import * as fs from 'fs';
import * as path from 'path';

let server: Server | undefined;
let statusBarItem: vscode.StatusBarItem;
let app: express.Application;
let logFilePath: string;

function logMessage(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} - ${message}\n`;
  fs.appendFileSync(logFilePath, logEntry);
}

function startServer(): boolean {
  if (server) {
    logMessage('Server start attempted while already running');
    vscode.window.showInformationMessage('Server is already running');
    return false;
  }

  const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
  const port = config.get('port', 3775);

  app = express();
  app.use(express.json());

  // Log incoming requests
  app.use((req, res, next) => {
    logMessage(`Incoming ${req.method} request to ${req.path}`);
    next();
  });

  // Models endpoint
  app.get('/v1/models', (req, res) => {
    logMessage('Models endpoint accessed');
    res.json({
      object: 'list',
      data: [
        {
          id: 'claude-3.5-sonnet',
          object: 'model',
          created: 1677610602,
          owned_by: 'openai',
        },
        {
          id: 'gpt-4o',
          object: 'model',
          created: 1687882412,
          owned_by: 'openai',
        },
        {
          id: 'gpt-4o-mini',
          object: 'model',
          created: 1687882412,
          owned_by: 'openai',
        },
        {
          id: 'o3-mini',
          object: 'model',
          created: 1687882412,
          owned_by: 'openai',
        },
        {
          id: 'o1',
          object: 'model',
          created: 1687882412,
          owned_by: 'openai',
        }
      ]
    });
  });

  // Chat completions endpoint
  app.post('/v1/chat/completions', async (req, res) => {
    logMessage('Chat completion request received');
    logMessage(`Request body: ${JSON.stringify(req.body, null, 2)}`);
    
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
      const defaultModel = vscode.workspace.getConfiguration('openaiCompatibleServer').get('defaultModel', 'gpt-4o');
      const modelId = req.body.model || defaultModel;
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: modelId });
      let model: vscode.LanguageModelChat | undefined;
      if (!models || models.length === 0) {
        // Option A: Provide a fallback model if you have one defined
        // e.g., try an alternate family name:
        const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'alternativeModel' });
        if (fallbackModels && fallbackModels.length > 0) {
          model = fallbackModels[0];
        } else {
          throw new Error(`No model available for requested family: ${modelId}`);
        }
      } else {
        model = models[0];
      }

      logMessage(`Selected model: ${modelId}`);

      let chatResponse: vscode.LanguageModelChatResponse | undefined = await model.sendRequest(craftedPrompt, {}, new vscode.CancellationTokenSource().token);

      if (!chatResponse) {
        logMessage('No response received from language model');
        throw new Error('No response from language model');
      }

      if (stream) {
        logMessage('Starting streaming response');
        // Send initial response
        const initialResponse = {
          id: 'chatcmpl-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
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
              model: modelId,
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
        logMessage('Generating non-streaming response');
        // Non-streaming response
        let responseText = '';
        for await (const fragment of chatResponse.text) {
          responseText += fragment;
        }

        res.json({
          id: 'chatcmpl-' + Date.now(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
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
      logMessage(`Error in chat completion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('Error generating response:', error);
      res.status(500).json({
        error: {
          message: 'Error generating response from language model',
          type: 'internal_server_error'
        }
      });
    }
  });

  server = app.listen(port, () => {
    logMessage(`Server started on port ${port}`);
    vscode.window.showInformationMessage(`OpenAI compatible server running on http://localhost:${port}`);
    updateStatusBar();
  });

  return true;
}

function stopServer(): boolean {
  if (!server) {
    logMessage('Server stop attempted while not running');
    vscode.window.showInformationMessage('Server is not running');
    return false;
  }

  server.close();
  server = undefined;
  logMessage('Server stopped');
  vscode.window.showInformationMessage('OpenAI compatible server stopped');
  updateStatusBar();
  return true;
}

function updateStatusBar() {
  if (server) {
    statusBarItem.text = '$(stop) Stop API Server';
    statusBarItem.tooltip = 'Click to stop OpenAI Compatible Server';
    statusBarItem.command = 'openai-compatible-vscode-llm-server.stop';
  } else {
    statusBarItem.text = '$(play) Start API Server';
    statusBarItem.tooltip = 'Click to start OpenAI Compatible Server';
    statusBarItem.command = 'openai-compatible-vscode-llm-server.start';
  }
}

async function showLogs() {
  if (!logFilePath || !fs.existsSync(logFilePath)) {
    vscode.window.showErrorMessage('No logs available');
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(logFilePath);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open logs: ${error}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  if (!context.storageUri) {
    const fallbackPath = context.extensionUri.fsPath;
    logFilePath = path.join(fallbackPath, 'server.log');
  } else {
    const storagePath = context.storageUri.fsPath;
    logFilePath = path.join(storagePath, 'server.log');
  }
  
  logMessage('Extension activated');

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  statusBarItem.show();

  // Register start server command
  let startCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.start', () => {
    startServer();
    updateStatusBar();
  });

  // Register stop server command
  let stopCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.stop', () => {
    stopServer();
    updateStatusBar();
  });

  // Register status command
  let statusCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.status', () => {
    if (server) {
      const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
      const port = config.get('port', 3775);
      vscode.window.showInformationMessage(`Server is running on http://localhost:${port}`);
    } else {
      vscode.window.showInformationMessage('Server is not running');
    }
  });

  let viewLogsCommand = vscode.commands.registerCommand('openai-compatible-vscode-llm-server.viewLogs', showLogs);
  context.subscriptions.push(viewLogsCommand);

  context.subscriptions.push(startCommand);
  context.subscriptions.push(stopCommand);
  context.subscriptions.push(statusCommand);

  const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
  const autoStart = config.get('autoStart', false);

  if (autoStart) {
    try {
      startServer();
      updateStatusBar();
    } catch (err) {
      vscode.window.showErrorMessage('Failed to start server automatically: ' + err);
    }
  }
}

export function deactivate() {
  if (server) {
    server.close();
    logMessage('Server stopped during extension deactivation');
    vscode.window.showInformationMessage('OpenAI compatible server stopped');
  }
  statusBarItem.dispose();
  logMessage('Extension deactivated');
}
