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

Currently, there are no configurable settings. The server runs on port 3000 by default.

## Known Issues

- The server currently returns mock responses
- Port 3000 is hardcoded (will be configurable in future versions)

## Release Notes

### 0.0.1

Initial release:
- Basic OpenAI-compatible API server
- Models and chat completions endpoints
- Server status command
