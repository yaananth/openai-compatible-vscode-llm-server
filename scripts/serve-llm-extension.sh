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
  logs                 Tail the extension server log (Ctrl+C to exit).
  clean                Remove generated .vsix artifacts.

Examples:
  servecopilot start
  servecopilot install
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
    if command -v code >/dev/null 2>&1; then
        echo "code"
    elif command -v codei >/dev/null 2>&1; then
        echo "codei"
    else
        echo "error: no VS Code CLI (code/codei) found in PATH." >&2
        exit 1
    fi
}

run_npm_tasks() {
    (cd "$REPO_DIR" && npm install && npm run compile)
}

prepare_dev_workspace() {
    mkdir -p "$DEV_WORKSPACE_VSCODE_DIR" "$DEV_USER_DATA_DIR" "$DEV_EXTENSIONS_DIR"
    cat >"$DEV_WORKSPACE_VSCODE_DIR/settings.json" <<EOF
{
  "openaiCompatibleServer.autoStart": true,
  "openaiCompatibleServer.port": $SERVER_PORT,
  "openaiCompatibleServer.defaultModel": "claude-sonnet-4.5"
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
    (cd "$REPO_DIR" && npm install && npm run compile && npx @vscode/vsce package --no-dependencies --out "$VSIX_PATH")
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
        ;;
    stop)
        terminate_existing_dev_instance
        echo "Dedicated Code Insiders instance stopped (if it was running)."
        ;;
    install)
        build_vsix
        INSTALL_CLI="$(resolve_install_cli)"
        "$INSTALL_CLI" --install-extension "$BUILD_VSIX_PATH"
        ;;
    update)
        build_vsix
        INSTALL_CLI="$(resolve_install_cli)"
        "$INSTALL_CLI" --install-extension "$BUILD_VSIX_PATH" --force
        ;;
    package)
        build_vsix
        echo "VSIX created at $BUILD_VSIX_PATH"
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
