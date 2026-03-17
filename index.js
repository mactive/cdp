import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const CONFIG = {
  // Chrome 调试端口，需要先用 --remote-debugging-port=9222 启动 Chrome
  debuggerUrl: 'http://localhost:9222',
  downloadDir: path.join(__dirname, 'downloads'),
  maxImages: 10,
  geminiUrl: 'https://gemini.google.com/mystuff'
};

// 创建下载目录
if (!fs.existsSync(CONFIG.downloadDir)) {
  fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url, filepath) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));
}

async function main() {
  let browser;

  try {
    console.log('连接到现有 Chrome 浏览器...');
    console.log('请确保 Chrome 已用以下命令启动：');
    console.log('  macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    console.log('  或者: open -a "Google Chrome" --args --remote-debugging-port=9222\n');

    // 连接到现有的 Chrome 实例
    browser = await puppeteer.connect({
      browserURL: CONFIG.debuggerUrl,
      defaultViewport: null
    });

    const pages = await browser.pages();
    let page = pages[0];

    // 设置下载行为
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: CONFIG.downloadDir
    });

    // 监听下载事件
    let downloadStarted = false;
    let downloadCompleted = false;
    let currentDownloadGuid = null;

    client.on('Browser.downloadWillBegin', (event) => {
      console.log(`  [下载] 开始下载: ${event.suggestedFilename}`);
      downloadStarted = true;
      currentDownloadGuid = event.guid;
    });

    client.on('Browser.downloadProgress', (event) => {
      if (event.state === 'completed') {
        console.log(`  [下载] 下载完成`);
        downloadCompleted = true;
      } else if (event.state === 'canceled') {
        console.log(`  [下载] 下载取消`);
        downloadCompleted = true;
      }
    });

    // 启用下载事件监听
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: CONFIG.downloadDir,
      eventsEnabled: true
    });

    console.log(`导航到 ${CONFIG.geminiUrl}...`);
    await page.goto(CONFIG.geminiUrl, { waitUntil: 'networkidle2' });
    await sleep(3000);

    console.log('等待页面加载...');

    // 查找所有对话卡片（class="library-item-card"）
    const conversationCards = await page.$$('div.library-item-card');
    console.log(`找到 ${conversationCards.length} 个对话`);

    const limit = Math.min(CONFIG.maxImages, conversationCards.length);
    let downloadCount = 0;

    for (let i = 0; i < limit; i++) {
      try {
        console.log(`\n处理第 ${i + 1}/${limit} 个对话...`);

        // 只在第一次之后返回 mystuff 页面
        if (i > 0) {
          console.log('  返回 mystuff 页面...');
          await page.goto(CONFIG.geminiUrl, { waitUntil: 'networkidle2' });
          await sleep(2000);
        }

        // 重新获取卡片列表
        const cards = await page.$$('div.library-item-card');
        if (i >= cards.length) {
          console.log('  没有更多卡片了');
          break;
        }

        console.log(`  点击第 ${i + 1} 个卡片...`);

        // 点击进入对话页面
        await cards[i].click();
        await sleep(3000);

        // 检查当前 URL
        const currentUrl = page.url();
        console.log(`  当前页面: ${currentUrl}`);

        // 确认已进入对话页面
        if (!currentUrl.includes('/app/') && !currentUrl.includes('/gem/')) {
          console.log('  未进入对话页面，跳过');
          continue;
        }

        // 等待对话页面加载
        await page.waitForSelector('img', { timeout: 5000 });

        // 查找对话中的图片
        const images = await page.$$('img[src*="googleusercontent"]');
        console.log(`  找到 ${images.length} 张图片`);

        if (images.length > 0) {
          // 移动到第一张图片上（触发 hover）
          console.log('  移动到图片上...');
          await images[0].hover();
          await sleep(1000);

          // 查找所有按钮
          const allButtons = await page.$$('button');
          console.log(`  页面上共有 ${allButtons.length} 个按钮`);

          // 找到第三个下载相关的按钮（最后一个是下载完整尺寸）
          let downloadButtons = [];
          for (let btn of allButtons) {
            const ariaLabel = await btn.evaluate(el => el.getAttribute('aria-label') || '');
            if (ariaLabel.includes('下载') || ariaLabel.includes('Download')) {
              downloadButtons.push({ button: btn, label: ariaLabel });
              console.log(`  找到下载按钮 ${downloadButtons.length}: ${ariaLabel}`);
            }
          }

          if (downloadButtons.length >= 3) {
            // 点击第三个按钮（下载完整尺寸）
            console.log(`  点击第 3 个下载按钮: ${downloadButtons[2].label}`);

            // 重置下载状态
            downloadStarted = false;
            downloadCompleted = false;

            await downloadButtons[2].button.click();

            // 等待下载开始
            console.log('  等待下载开始...');
            let waitTime = 0;
            while (!downloadStarted && waitTime < 30000) {
              await sleep(500);
              waitTime += 500;
            }

            if (!downloadStarted) {
              console.log('  ✗ 下载未开始（超时）');
              continue;
            }

            // 等待下载完成
            console.log('  等待下载完成...');
            waitTime = 0;
            while (!downloadCompleted && waitTime < 60000) {
              await sleep(500);
              waitTime += 500;
            }

            if (downloadCompleted) {
              downloadCount++;
              console.log(`  ✓ 下载完成 (${downloadCount}/${limit})`);
            } else {
              console.log('  ⚠ 下载可能未完成（超时）');
            }

          } else if (downloadButtons.length > 0) {
            // 如果只有一个或两个按钮，点击最后一个
            const lastButton = downloadButtons[downloadButtons.length - 1];
            console.log(`  点击最后一个下载按钮: ${lastButton.label}`);

            // 重置下载状态
            downloadStarted = false;
            downloadCompleted = false;

            await lastButton.button.click();

            // 等待下载开始
            console.log('  等待下载开始...');
            let waitTime = 0;
            while (!downloadStarted && waitTime < 30000) {
              await sleep(500);
              waitTime += 500;
            }

            if (!downloadStarted) {
              console.log('  ✗ 下载未开始（超时）');
              continue;
            }

            // 等待下载完成
            console.log('  等待下载完成...');
            waitTime = 0;
            while (!downloadCompleted && waitTime < 60000) {
              await sleep(500);
              waitTime += 500;
            }

            if (downloadCompleted) {
              downloadCount++;
              console.log(`  ✓ 下载完成 (${downloadCount}/${limit})`);
            } else {
              console.log('  ⚠ 下载可能未完成（超时）');
            }
          } else {
            console.log('  未找到下载按钮');
          }
        }

      } catch (error) {
        console.error(`  处理第 ${i + 1} 个对话时出错:`, error.message);
      }
    }

    console.log(`\n完成！共下载 ${downloadCount} 张图片到: ${CONFIG.downloadDir}`);

  } catch (error) {
    console.error('错误:', error.message);

    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      console.error('\n无法连接到 Chrome。请先启动 Chrome 并开启远程调试：');
      console.error('  运行: ./start-chrome.sh');
      console.error('  或手动运行: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    }
  } finally {
    if (browser) {
      await browser.disconnect();
    }
  }
}

main();
