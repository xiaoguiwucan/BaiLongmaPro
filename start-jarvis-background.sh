#!/bin/zsh
APP_DIR="/Users/imac/开发项目/codx/白龙马agent"
cd "$APP_DIR" || exit 1

if ! curl -fsS http://127.0.0.1:8018/health >/dev/null 2>&1; then
  if [ -d "/Users/imac/开发项目/codx/honcho" ]; then
    if ! docker info >/dev/null 2>&1; then
      /usr/bin/open -a Docker >/dev/null 2>&1 || true
      for i in {1..45}; do
        docker info >/dev/null 2>&1 && break
        sleep 2
      done
    fi
    if docker info >/dev/null 2>&1; then
      (cd "/Users/imac/开发项目/codx/honcho" && docker compose up -d) || true
    else
      mkdir -p "/Users/imac/Library/Application Support/Bailongma/logs"
      echo "[$(date '+%F %T')] Docker daemon unavailable; skipped Honcho startup" >> "/Users/imac/Library/Application Support/Bailongma/logs/startup.log"
    fi
  fi
fi

# 避免重复实例/端口冲突。
# Electron 有时显示为 `electron .`，有时显示为 Electron 二进制 + 项目绝对路径；
# 两种都要清掉，否则会出现旧代码还在 3721、新实例启动失败的假象。
pkill -f "node .*electron .*($APP_DIR|\\.)" 2>/dev/null || true
pkill -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $APP_DIR" 2>/dev/null || true
pkill -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ." 2>/dev/null || true
pkill -f "--app-path=$APP_DIR" 2>/dev/null || true
pkill -f "$APP_DIR/src/voice/sensevoice_server.py" 2>/dev/null || true
sleep 1

mkdir -p "/Users/imac/Library/Application Support/Bailongma/logs"
{
  echo "[$(date '+%F %T')] launching Electron.app directly"
  echo "APP_DIR=$APP_DIR"
} > "/Users/imac/Library/Application Support/Bailongma/logs/startup.log"

# 在 macOS 上用 open 启动 Electron.app，而不是 `nohup npm start`。
# 这样进程归 LaunchServices 管理，不会被当前终端/自动化会话结束时顺手杀掉。
/usr/bin/open -n "$APP_DIR/node_modules/electron/dist/Electron.app" --args "$APP_DIR"

sleep 1
pgrep -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $APP_DIR" | head -1 > "/tmp/bailongma.pid" || true
echo "Jarvis/Bailongma started. PID=$(cat /tmp/bailongma.pid 2>/dev/null || echo unknown)"
echo "Logs: /Users/imac/Library/Application Support/Bailongma/logs/bailongma.log"
