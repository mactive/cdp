# Gemini 图片下载工具

使用 Chrome DevTools Protocol (CDP) 从 Gemini 下载图片。

## 使用步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 Chrome（开启远程调试）

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

或者：
```bash
open -a "Google Chrome" --args --remote-debugging-port=9222
```

**Windows:**
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222
```

### 3. 登录 Gemini

在打开的 Chrome 浏览器中访问 https://gemini.google.com 并登录你的账号。

### 4. 运行脚本

```bash
npm start
```

## 功能

- 连接到现有的 Chrome 浏览器实例
- 访问 Gemini mystuff 页面
- 自动点击前 10 个对话
- 进入对话后查找图片
- 点击图片并下载完整尺寸版本
- 图片保存到 `downloads` 目录

## 配置

可以在 `index.js` 中修改 `CONFIG` 对象：

- `debuggerUrl`: Chrome 调试端口（默认 9222）
- `downloadDir`: 下载目录
- `maxImages`: 最大下载数量（默认 10）
- `geminiUrl`: Gemini 页面 URL

## 注意事项

- 需要先登录 Gemini 账号
- 确保 Chrome 已开启远程调试端口
- 脚本会自动处理页面导航和点击操作
