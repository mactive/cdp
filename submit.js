import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mdFile = process.argv[2];
const pageUrl = process.argv[3];

// 解析 --start N 参数（1-based）
let startFrom = 1;
for (let i = 4; i < process.argv.length; i++) {
  if (process.argv[i] === '--start' && process.argv[i + 1]) {
    startFrom = parseInt(process.argv[i + 1], 10);
    if (isNaN(startFrom) || startFrom < 1) {
      console.error('--start 参数必须是正整数');
      process.exit(1);
    }
    break;
  }
}

if (!mdFile || !pageUrl) {
  console.error('用法: node submit.js <markdown文件> <页面URL> [--start N]');
  process.exit(1);
}

const CONFIG = {
  debuggerUrl: 'http://localhost:9222',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 按同级标题（首个出现的标题级别）或 *** / --- 分割 markdown
function splitMarkdown(content) {
  const lines = content.split('\n');

  // 找第一个标题的级别（如 ### → prefix = '###'）
  let headingPrefix = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,6}) /);
    if (m) { headingPrefix = m[1]; break; }
  }

  const sections = [];
  let current = [];

  for (const line of lines) {
    const isHeading = headingPrefix && line.startsWith(headingPrefix + ' ');
    const isSeparator = line.trim() === '***' || line.trim() === '---';

    if (isHeading || isSeparator) {
      const s = current.join('\n').trim();
      if (s) sections.push(s);
      current = isSeparator ? [] : [line]; // 分隔符本身丢弃，标题保留到新段
    } else {
      current.push(line);
    }
  }
  const last = current.join('\n').trim();
  if (last) sections.push(last);

  return sections;
}

async function main() {
  // 读取并分割 markdown（按同级标题或 *** 分割）
  const content = fs.readFileSync(mdFile, 'utf-8');
  const sections = splitMarkdown(content);
  console.log(`共 ${sections.length} 个段落`);
  sections.forEach((s, i) => {
    const preview = s.slice(0, 60).replace(/\n/g, ' ');
    console.log(`  [${i + 1}] ${preview}...`);
  });
  if (startFrom > 1) console.log(`\n从第 ${startFrom} 段开始（断点续传）`);
  console.log('');

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: CONFIG.debuggerUrl,
      defaultViewport: null,
      protocolTimeout: 600000, // 10 分钟，覆盖默认的 180s
    });

    const pages = await browser.pages();
    const page = pages[0];

    console.log(`导航到: ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // 切换到 Pro 模式
    console.log('切换到 Pro 模式...');
    const modeBtn = await page.$('button[data-test-id="bard-mode-menu-button"]');
    if (modeBtn) {
      await modeBtn.click();
      await sleep(800);
      const proBtn = await page.$('button[data-test-id="bard-mode-option-pro"]');
      if (proBtn) {
        await proBtn.click();
        await sleep(800);
        console.log('  ✓ 已切换到 Pro');
      } else {
        console.log('  未找到 Pro 选项，继续...');
      }
    } else {
      console.log('  未找到模式选择按钮，继续...');
    }

    for (let i = startFrom - 1; i < sections.length; i++) {
      const section = sections[i];
      console.log(`\n[${i + 1}/${sections.length}] 填入第 ${i + 1} 段...`);

      // 等待输入框就绪（发送按钮为 .submit 状态）
      await page.waitForSelector('button.send-button.submit', { timeout: 60000 });
      await page.waitForSelector('div.ql-editor[contenteditable="true"]', { timeout: 10000 });

      // 聚焦输入框，全选清空，然后用 execCommand 插入文本
      await page.evaluate((text) => {
        const el = document.querySelector('div.ql-editor[contenteditable="true"]');
        if (!el) throw new Error('找不到输入框');
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }, section);

      await sleep(500);

      // 用 Cmd+Enter 提交（比点按钮更可靠）
      await page.keyboard.down('Meta');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Meta');
      console.log('  已发送，等待生成...');
      await sleep(1500);

      // 等待按钮变为 .stop（开始生成）
      try {
        await page.waitForSelector('button.send-button.stop', { timeout: 15000 });
        console.log('  生成中...');
      } catch {
        console.log('  (未检测到 stop 状态，可能已快速完成)');
      }

      // 等待按钮恢复为 .submit（生成完毕）
      await page.waitForSelector('button.send-button.submit', { timeout: 300000 });
      console.log(`  ✓ 第 ${i + 1} 段生成完成`);
      await sleep(1000);
    }

    console.log(`\n全部完成！共提交 ${sections.length} 段`);

  } catch (error) {
    console.error('错误:', error.message);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      console.error('无法连接到 Chrome，请先启动: ./start-chrome.sh');
    }
  } finally {
    if (browser) await browser.disconnect();
  }
}

main();
