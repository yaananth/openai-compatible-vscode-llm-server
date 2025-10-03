#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSIX_DIR="$REPO_DIR/.vsix"
VSIX_NAME="openai-compatible-vscode-llm-server"
VSIX_PATH="$VSIX_DIR/${VSIX_NAME}.vsix"
BUILD_VSIX_PATH=""
DEV_CODE_CLI="${DEV_CODE_CLI:-codei}"
SERVER_PORT="${SERVER_PORT:-3775}"
MODEL_POLL_ATTEMPTS="${MODEL_POLL_ATTEMPTS:-30}"
MODEL_POLL_DELAY="${MODEL_POLL_DELAY:-2}"
DEV_WORKSPACE_DIR="$REPO_DIR/.dev-workspace"
DEV_WORKSPACE_VSCODE_DIR="$DEV_WORKSPACE_DIR/.vscode"
DEV_USER_DATA_DIR="$DEV_WORKSPACE_DIR/.vscode-user"
DEV_EXTENSIONS_DIR="$DEV_WORKSPACE_DIR/.vscode-extensions"
DEV_PID_FILE="$DEV_WORKSPACE_DIR/.insiders.pid"

print_usage() {
    cat <<'EOF'
Usage: servecopilot <command> [args]

Commands:
  start [code-args]    Launch VS Code with the extension in development mode.
  launch [code-args]   Alias for start.
  stop                 Terminate the dedicated Code Insiders instance launched via start.
  install              Package the extension and install it into VS Code.
  update               Package and reinstall (force) the extension.
  package              Package the extension into .vsix (no install).
  status               Check if the server is running and test the models endpoint.
  logs                 Tail the extension server log (Ctrl+C to exit).
  clean                Remove generated .vsix artifacts.

Examples:
  servecopilot start
  servecopilot install
  servecopilot status
  servecopilot package
EOF
}

ensure_code_cli() {
    local cli_name="$1"
    if ! command -v "$cli_name" >/dev/null 2>&1; then
        echo "error: VS Code CLI '$cli_name' not found in PATH." >&2
        exit 1
    fi
}

resolve_install_cli() {
    # Prefer VSCode instance with Copilot installed
    if command -v codei >/dev/null 2>&1; then
        if codei --list-extensions 2>/dev/null | grep -q "github.copilot"; then
            echo "codei"
            return 0
        fi
    fi
    
    if command -v code >/dev/null 2>&1; then
        if code --list-extensions 2>/dev/null | grep -q "github.copilot"; then
            echo "code"
            return 0
        fi
    fi
    
    # Fallback to any available CLI
    if command -v codei >/dev/null 2>&1; then
        echo "codei"
    elif command -v code >/dev/null 2>&1; then
        echo "code"
    else
        echo "error: no VS Code CLI (code/codei) found in PATH." >&2
        exit 1
    fi
}

get_vscode_settings_path() {
    local cli_name="$1"
    if [ "$cli_name" = "codei" ] || [ "$cli_name" = "code-insiders" ]; then
        if [ "$(uname)" = "Darwin" ]; then
            echo "$HOME/Library/Application Support/Code - Insiders/User/settings.json"
        else
            echo "$HOME/.config/Code - Insiders/User/settings.json"
        fi
    else
        if [ "$(uname)" = "Darwin" ]; then
            echo "$HOME/Library/Application Support/Code/User/settings.json"
        else
            echo "$HOME/.config/Code/User/settings.json"
        fi
    fi
}

ensure_autostart_enabled() {
    local cli_name="$1"
    local settings_file
    settings_file="$(get_vscode_settings_path "$cli_name")"
    
    if [ ! -f "$settings_file" ]; then
        mkdir -p "$(dirname "$settings_file")"
        echo '{}' > "$settings_file"
    fi
    
    # Use python to safely update JSON
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$settings_file" <<'PYTHON'
import json
import sys

settings_file = sys.argv[1]
try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except:
    settings = {}

# Update settings
settings['openaiCompatibleServer.autoStart'] = True
settings['openaiCompatibleServer.port'] = 3775

with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)
    
print(f"✓ Auto-start enabled in {settings_file}")
PYTHON
    else
        echo "⚠️  Python not found. Please manually enable 'openaiCompatibleServer.autoStart' in VSCode settings."
    fi
}

wait_for_server() {
    echo "Waiting for server to start on port ${SERVER_PORT}..."
    local attempt=1
    local max_attempts=30
    while [ "$attempt" -le "$max_attempts" ]; do
        if lsof -i ":${SERVER_PORT}" >/dev/null 2>&1; then
            echo "✅ Server is running on port ${SERVER_PORT}"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    echo "⚠️  Server not detected on port ${SERVER_PORT} after ${max_attempts} seconds."
    echo "    The extension may need to be manually activated in VSCode."
    return 1
}

check_copilot_installed() {
    local cli_name="$1"
    if "$cli_name" --list-extensions 2>/dev/null | grep -q "github.copilot"; then
        return 0
    else
        return 1
    fi
}

trigger_server_start() {
    local cli_name="$1"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "ACTIVATION REQUIRED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Check if Copilot is installed
    if check_copilot_installed "$cli_name"; then
        echo "✅ GitHub Copilot is installed"
    else
        echo "⚠️  GitHub Copilot is NOT installed in this VSCode instance"
        echo ""
        echo "IMPORTANT: This extension requires GitHub Copilot to function."
        echo "The server will start but will return errors when querying models."
        echo ""
        echo "To install GitHub Copilot:"
        echo "  1. Open VSCode"
        echo "  2. Go to Extensions (Cmd+Shift+X)"
        echo "  3. Search for 'GitHub Copilot'"
        echo "  4. Install both 'GitHub Copilot' and 'GitHub Copilot Chat'"
        echo "  5. Sign in with your GitHub account"
        echo ""
    fi
    
    echo "The extension is installed but needs to be activated."
    echo ""
    echo "Please do ONE of the following:"
    echo ""
    echo "Option 1: Restart VSCode completely (RECOMMENDED)"
    echo "  • Quit VSCode and reopen it"
    echo "  • Auto-start is enabled, so the server will start automatically"
    echo ""
    echo "Option 2: Reload VSCode window"
    echo "  • Press: Cmd+Shift+P (Mac) or Ctrl+Shift+P"
    echo "  • Type: 'Developer: Reload Window'"
    echo "  • Press Enter"
    echo ""
    echo "Option 3: Start server manually (without auto-start)"
    echo "  • Press: Cmd+Shift+P (Mac) or Ctrl+Shift+P"
    echo "  • Type: 'OpenAI Server: Start OpenAI Server'"
    echo "  • Press Enter"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    read -p "Press ENTER after you've restarted/reloaded VSCode..." 
    echo ""
    echo "Checking if server started..."
    wait_for_server
    
    if lsof -i ":${SERVER_PORT}" >/dev/null 2>&1; then
        echo ""
        echo "Testing models endpoint..."
        if command -v curl >/dev/null 2>&1; then
            if curl -sf "http://localhost:${SERVER_PORT}/v1/models" >/dev/null 2>&1; then
                echo "✅ Server is working! Models are available."
                echo ""
                echo "Available models:"
                curl -s "http://localhost:${SERVER_PORT}/v1/models" | python3 -c "import sys, json; data = json.load(sys.stdin); print('\n'.join(['  • ' + m['id'] for m in data.get('data', [])]))" 2>/dev/null || echo "  (Unable to list models)"
            else
                echo "⚠️  Server is running but models endpoint returned an error."
                echo "    This usually means GitHub Copilot is not available."
                echo ""
                curl -s "http://localhost:${SERVER_PORT}/v1/models" 2>/dev/null
            fi
        fi
    fi
}

run_npm_tasks() {
    (cd "$REPO_DIR" && npm install)
    if [ -f "$REPO_DIR/out/extension.js" ]; then
        echo "✓ Compiled code found, skipping compilation"
    else
        (cd "$REPO_DIR" && npm run compile)
    fi
}

prepare_dev_workspace() {
    mkdir -p "$DEV_WORKSPACE_VSCODE_DIR" "$DEV_USER_DATA_DIR" "$DEV_EXTENSIONS_DIR"
    cat >"$DEV_WORKSPACE_VSCODE_DIR/settings.json" <<EOF
{
  "openaiCompatibleServer.autoStart": true,
  "openaiCompatibleServer.port": $SERVER_PORT,
  "openaiCompatibleServer.defaultModel": "anthropic/claude-3.7-sonnet:thinking"
}
EOF
}

wait_for_process() {
    local pattern="$1"
    local attempts=20
    local delay=1
    local i=1
    while [ "${i}" -le "${attempts}" ]; do
        if pgrep -fl "$pattern" >/dev/null 2>&1; then
            return 0
        fi
        sleep "$delay"
        i=$((i + 1))
    done
    return 1
}

poll_models_endpoint() {
    command -v curl >/dev/null 2>&1 || {
        echo "warning: curl not available; skipping /v1/models validation." >&2
        return 0
    }

    local url="http://127.0.0.1:${SERVER_PORT}/v1/models"
    local attempt=1
    while [ "$attempt" -le "$MODEL_POLL_ATTEMPTS" ]; do
        if curl -sSf "$url" >/dev/null 2>&1; then
            echo "✔️  Models endpoint responding at $url"
            return 0
        fi
        sleep "$MODEL_POLL_DELAY"
        attempt=$((attempt + 1))
    done

    echo "⚠️  Unable to reach $url after $MODEL_POLL_ATTEMPTS attempts. The server may not have started yet." >&2
    return 1
}

build_vsix() {
    mkdir -p "$VSIX_DIR"
    rm -f "$VSIX_PATH"
    (cd "$REPO_DIR" && npm install)
    if [ -f "$REPO_DIR/out/extension.js" ]; then
        echo "✓ Compiled code found, skipping compilation"
    else
        (cd "$REPO_DIR" && npm run compile)
    fi
    # Package WITH dependencies (express, body-parser etc needed at runtime)
    (cd "$REPO_DIR" && npx @vscode/vsce package --out "$VSIX_PATH")
    BUILD_VSIX_PATH="$VSIX_PATH"
}

terminate_existing_dev_instance() {
    if pgrep -f "$DEV_USER_DATA_DIR" >/dev/null 2>&1; then
        echo "Stopping existing dedicated Code Insiders instance..."
        pkill -f "$DEV_USER_DATA_DIR" || true
        sleep 2
    fi
    rm -f "$DEV_PID_FILE"
}

record_dev_instance_pid() {
    local pids
    pids=$(pgrep -f "$DEV_USER_DATA_DIR" || true)
    if [ -n "$pids" ]; then
        echo "$pids" | head -n 1 > "$DEV_PID_FILE"
    fi
}

launch_code_insiders_background() {
    echo "Launching Code Insiders in the background..."
    "$DEV_CODE_CLI" --new-window \
        --extensionDevelopmentPath="$REPO_DIR" \
        --user-data-dir="$DEV_USER_DATA_DIR" \
        --extensions-dir="$DEV_EXTENSIONS_DIR" \
        "$DEV_WORKSPACE_DIR" "$@" >/dev/null 2>&1 &
    local launch_pid=$!
    disown "$launch_pid" 2>/dev/null || true
    local waited=0
    local max_wait=15
    while [ "$waited" -lt "$max_wait" ]; do
        if pgrep -f "$DEV_USER_DATA_DIR" >/dev/null 2>&1; then
            record_dev_instance_pid
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    echo "warning: unable to verify Code Insiders background launch." >&2
}

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
    start|launch)
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "DEVELOPMENT MODE"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "⚠️  IMPORTANT: This launches a development instance"
        echo "    without access to your GitHub Copilot extension."
        echo ""
        echo "    The server will start but will NOT have models available."
        echo ""
        echo "For a working server with Copilot models, use:"
        echo "  • servecopilot install    (install to your main VSCode)"
        echo "  • servecopilot update     (update existing installation)"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        read -p "Press ENTER to continue with development mode anyway, or Ctrl+C to cancel..." 
        echo ""
        run_npm_tasks
        ensure_code_cli "$DEV_CODE_CLI"
        prepare_dev_workspace
        terminate_existing_dev_instance
        launch_code_insiders_background "$@"
        if wait_for_process "$DEV_USER_DATA_DIR"; then
            echo "Code Insiders instance detected."
        else
            echo "warning: could not confirm Code Insiders process; continuing." >&2
        fi
        poll_models_endpoint &
        POLL_PID=$!
        disown "$POLL_PID" 2>/dev/null || true
        echo "Server validation running in background (PID: $POLL_PID)."
        echo ""
        echo "NOTE: Models endpoint will return errors in development mode."
        echo "      Use 'servecopilot install' for full functionality."
        ;;
    stop)
        terminate_existing_dev_instance
        echo "Dedicated Code Insiders instance stopped (if it was running)."
        ;;
    install)
        build_vsix
        INSTALL_CLI="$(resolve_install_cli)"
        echo "Installing extension to $INSTALL_CLI..."
        "$INSTALL_CLI" --install-extension "$BUILD_VSIX_PATH"
        echo "✓ Extension installed"
        echo ""
        ensure_autostart_enabled "$INSTALL_CLI"
        echo ""
        echo "Extension installed successfully!"
        trigger_server_start "$INSTALL_CLI"
        ;;
    update)
        build_vsix
        INSTALL_CLI="$(resolve_install_cli)"
        echo "Updating extension in $INSTALL_CLI..."
        "$INSTALL_CLI" --install-extension "$BUILD_VSIX_PATH" --force
        echo "✓ Extension updated"
        echo ""
        ensure_autostart_enabled "$INSTALL_CLI"
        echo ""
        echo "Extension updated successfully!"
        trigger_server_start "$INSTALL_CLI"
        ;;
    package)
        build_vsix
        echo "VSIX created at $BUILD_VSIX_PATH"
        ;;
    status)
        echo "Checking server status on port ${SERVER_PORT}..."
        if lsof -i ":${SERVER_PORT}" >/dev/null 2>&1; then
            echo "✅ Server is RUNNING on port ${SERVER_PORT}"
            echo ""
            echo "Testing /v1/models endpoint:"
            if command -v curl >/dev/null 2>&1; then
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                if curl -sf "http://localhost:${SERVER_PORT}/v1/models" >/dev/null 2>&1; then
                    echo "Response:"
                    curl -s "http://localhost:${SERVER_PORT}/v1/models" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:${SERVER_PORT}/v1/models"
                    echo ""
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo ""
                    echo "Model IDs available:"
                    curl -s "http://localhost:${SERVER_PORT}/v1/models" | python3 -c "import sys, json; data = json.load(sys.stdin); print('\n'.join(['  - ' + m['id'] for m in data.get('data', [])]))" 2>/dev/null || echo "  (Unable to parse model list)"
                else
                    echo "⚠️  Server is running but /v1/models endpoint returned an error"
                    curl -s "http://localhost:${SERVER_PORT}/v1/models" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:${SERVER_PORT}/v1/models"
                fi
            else
                echo "curl not available - cannot test endpoint"
            fi
        else
            echo "❌ Server is NOT running on port ${SERVER_PORT}"
            echo ""
            echo "To start the server:"
            echo "  • Run: servecopilot install"
            echo "  • Or manually start it in VSCode: Cmd+Shift+P → 'OpenAI Server: Start'"
        fi
        ;;
    logs)
        LOG_PATH="$REPO_DIR/server.log"
        if [ ! -f "$LOG_PATH" ]; then
            echo "No log file found at $LOG_PATH yet. Launch the extension once to generate logs." >&2
            exit 1
        fi
        echo "Tailing $LOG_PATH (press Ctrl+C to exit)..."
        tail -n 200 -f "$LOG_PATH"
        ;;
    clean)
        rm -rf "$VSIX_DIR"
        ;;
    help|-h|--help)
        print_usage
        ;;
    *)
        echo "error: unknown command '$COMMAND'" >&2
        print_usage
        exit 1
        ;;
esac
