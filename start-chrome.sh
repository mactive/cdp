#!/bin/bash

set -u

DEBUG_PORT=9222
PROFILE_DIR=/tmp/chrome-debug-profile

OS="$(uname -s)"
CHROME_CMD=()
CHROME_HINT=""
CHROME_KILL_PATTERN=""

case "$OS" in
  Darwin)
    CHROME_CMD=("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    CHROME_HINT="/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${DEBUG_PORT}"
    CHROME_KILL_PATTERN="Google Chrome"
    ;;
  Linux)
    if command -v google-chrome-stable >/dev/null 2>&1; then
      CHROME_CMD=("google-chrome-stable")
      CHROME_HINT="google-chrome-stable --remote-debugging-port=${DEBUG_PORT}"
      CHROME_KILL_PATTERN="google-chrome-stable|google-chrome|chromium|chromium-browser"
    elif command -v google-chrome >/dev/null 2>&1; then
      CHROME_CMD=("google-chrome")
      CHROME_HINT="google-chrome --remote-debugging-port=${DEBUG_PORT}"
      CHROME_KILL_PATTERN="google-chrome|chromium|chromium-browser"
    elif command -v chromium-browser >/dev/null 2>&1; then
      CHROME_CMD=("chromium-browser")
      CHROME_HINT="chromium-browser --remote-debugging-port=${DEBUG_PORT}"
      CHROME_KILL_PATTERN="chromium-browser|chromium"
    elif command -v chromium >/dev/null 2>&1; then
      CHROME_CMD=("chromium")
      CHROME_HINT="chromium --remote-debugging-port=${DEBUG_PORT}"
      CHROME_KILL_PATTERN="chromium"
    else
      echo "未找到 Chrome 可执行文件，请先安装 google-chrome-stable 或 google-chrome。"
      exit 1
    fi
    ;;
  *)
    echo "暂不支持的系统: ${OS}"
    exit 1
    ;;
esac

# 完全关闭所有 Chrome 进程
echo "关闭所有 Chrome 进程..."
pkill -9 -f "$CHROME_KILL_PATTERN" 2>/dev/null || true
sleep 2

# 清理临时目录
rm -rf "$PROFILE_DIR"

# 启动 Chrome（使用独立配置文件）
echo "启动 Chrome（调试模式）..."
"${CHROME_CMD[@]}" \
  --remote-debugging-port="$DEBUG_PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check &

# 等待 Chrome 启动
sleep 3

# 检查端口
echo ""
echo "检查调试端口..."
if curl -s "http://localhost:${DEBUG_PORT}/json/version" > /dev/null; then
    echo "✓ Chrome 调试端口已开启"
    echo ""
    echo "接下来："
    echo "1. 在 Chrome 中访问 https://gemini.google.com 并登录"
    echo "2. 访问 https://gemini.google.com/mystuff"
    echo "3. 运行: npm start"
else
    echo "✗ 调试端口未开启"
    echo ""
    echo "请手动运行以下命令："
    echo "$CHROME_HINT"
fi
