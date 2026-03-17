#!/bin/bash

# 完全关闭所有 Chrome 进程
echo "关闭所有 Chrome 进程..."
pkill -9 "Google Chrome"
sleep 2

# 清理临时目录
rm -rf /tmp/chrome-debug-profile

# 启动 Chrome（使用独立配置文件）
echo "启动 Chrome（调试模式）..."
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-profile \
  --no-first-run \
  --no-default-browser-check &

# 等待 Chrome 启动
sleep 3

# 检查端口
echo ""
echo "检查调试端口..."
if curl -s http://localhost:9222/json/version > /dev/null; then
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
    echo "/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222"
fi
