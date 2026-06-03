#!/bin/zsh
cd "/Users/imac/开发项目/codx/白龙马agent" || exit 1

# 启动白龙马专用 Honcho 群知识库（8018），不使用 8000
if ! curl -fsS http://127.0.0.1:8018/health >/dev/null 2>&1; then
  if [ -d "/Users/imac/开发项目/codx/honcho" ]; then
    if ! docker info >/dev/null 2>&1; then
      echo "Docker 未运行，正在打开 Docker Desktop…"
      /usr/bin/open -a Docker >/dev/null 2>&1 || true
      for i in {1..45}; do
        docker info >/dev/null 2>&1 && break
        sleep 2
      done
    fi
    cd "/Users/imac/开发项目/codx/honcho" || exit 1
    if docker info >/dev/null 2>&1; then
      docker compose up -d
    else
      echo "Docker daemon 仍不可用，跳过 Honcho 启动；白龙马将使用本地知识库兜底。"
    fi
    cd "/Users/imac/开发项目/codx/白龙马agent" || exit 1
  fi
fi

# 避免重复实例/端口冲突
APP_DIR="/Users/imac/开发项目/codx/白龙马agent"
pkill -f "node .*electron .*($APP_DIR|\\.)" 2>/dev/null || true
pkill -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $APP_DIR" 2>/dev/null || true
pkill -f "$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ." 2>/dev/null || true
pkill -f "--app-path=$APP_DIR" 2>/dev/null || true
pkill -f "$APP_DIR/src/voice/sensevoice_server.py" 2>/dev/null || true
sleep 1

# 用 macOS 原生 open 启动 Electron.app，关闭这个终端也不会杀掉程序。
/usr/bin/open -n "$APP_DIR/node_modules/electron/dist/Electron.app" --args "$APP_DIR"
echo "白龙马已启动。日志：$HOME/Library/Application Support/Bailongma/logs/bailongma.log"
