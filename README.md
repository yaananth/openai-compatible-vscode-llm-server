# OpenAI Compatible VSCode LLM Server

A VSCode extension that provides an OpenAI-compatible API server interface directly within VSCode.

## Features

- Implements OpenAI-compatible REST API endpoints
- Optional auto-start configuration
- Server status monitoring via status bar
- Integrated logging system
- Compatible with OpenAI API clients

## Endpoints

The server runs on `http://localhost:3775` by default and provides the following endpoints:

### GET /v1/models
Lists available models (currently returns mock data)

Example:
```bash
curl http://localhost:3775/v1/models
```

### POST /v1/chat/completions
Chat completion endpoint compatible with OpenAI's API format

Example:
```bash
curl -X POST http://localhost:3775/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ],
    "stream": true
  }'
```

## Using the Extension

1. Install the extension in VSCode
2. Use the command palette (Ctrl+Shift+P) to access the following commands:
   - "OpenAI Server: Start OpenAI Server"
   - "OpenAI Server: Stop OpenAI Server"
   - "OpenAI Server: Show OpenAI Server Status"
   - "OpenAI Compatible Server: View Server Logs"
3. Monitor server status in the VSCode status bar
4. The server will be available at the configured port (default: 3775)

## Requirements

- Visual Studio Code 1.96.0 or higher

## Extension Settings

This extension contributes the following settings:

* `openaiCompatibleServer.port`: Port number for the OpenAI compatible server (default: 3775)
* `openaiCompatibleServer.defaultModel`: Default model to use when none is specified in the request. One of:
  - `claude-3.5-sonnet`
  - `gpt-4o`
  - `gpt-4o-mini`
  - `o3-mini`
  - `o1`
  (default: `gpt-4o`)
* `openaiCompatibleServer.autoStart`: Automatically start the server when VSCode launches (default: false)

To modify these settings:
1. Open VSCode Settings (File > Preferences > Settings)
2. Search for "OpenAI Compatible Server"
3. Adjust the settings as needed

## Known Issues

- The server currently returns mock responses

## Release Notes

### 0.0.5

- Added logging system with viewable logs
- Added status bar integration
- Added auto-start configuration option
- Server port changed to 3775 by default
