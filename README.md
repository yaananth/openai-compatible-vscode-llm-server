# OpenAI Compatible VSCode LLM Server

A VSCode extension that provides an OpenAI-compatible API server interface directly within VSCode.

## Features

- Implements OpenAI-compatible REST API endpoints
- Automatically starts when VSCode launches
- Provides status command to check server status
- Compatible with OpenAI API clients

## Endpoints

The server runs on `http://localhost:3000` and provides the following endpoints:

### GET /v1/models
Lists available models (currently returns mock data for gpt-3.5-turbo and gpt-4)

Example:
```bash
curl http://localhost:3000/v1/models
```

### POST /v1/chat/completions
Chat completion endpoint compatible with OpenAI's API format

Example:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
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
2. The server automatically starts when VSCode launches
3. Use the "Show OpenAI Server Status" command to check the server status
4. The server will be available at `http://localhost:3000`

## Development

To build the extension:

1. Clone the repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch a new VSCode window with the extension

## Requirements

- Visual Studio Code 1.96.0 or higher

## Extension Settings

This extension contributes the following settings:

* `openaiCompatibleServer.port`: Port number for the OpenAI compatible server (default: 3000)
* `openaiCompatibleServer.defaultModel`: Default model to use when none is specified in the request. One of:
  - `claude-3.5-sonnet`
  - `gpt-4o`
  - `gpt-4o-mini`
  - `o3-mini`
  - `o1`
  (default: `gpt-4o`)

To modify these settings:
1. Open VSCode Settings (File > Preferences > Settings)
2. Search for "OpenAI Compatible Server"
3. Adjust the settings as needed

## Known Issues

- The server currently returns mock responses

## Release Notes

### 0.0.1

Initial release:
- Basic OpenAI-compatible API server
- Models and chat completions endpoints
- Server status command
