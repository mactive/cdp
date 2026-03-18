import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 解析命令行参数
const args = process.argv.slice(2);
let startIndex = 0;
let endIndex = 10;

// 解析参数：node index.js [start] [end]
if (args.length >= 1) {
  startIndex = parseInt(args[0]) - 1; // 用户输入从1开始，内部从0开始
  if (isNaN(startIndex) || startIndex < 0) {
    console.error('错误：起始索引必须是大于0的数字');
    process.exit(1);
  }
}

if (args.length >= 2) {
  endIndex = parseInt(args[1]);
  if (isNaN(endIndex) || endIndex <= startIndex + 1) {
    console.error('错误：结束索引必须大于起始索引');
    process.exit(1);
  }
}

// 配置
const CONFIG = {
  // Chrome 调试端口，需要先用 --remote-debugging-port=9222 启动 Chrome
  debuggerUrl: 'http://localhost:9222',
  downloadDir: path.join(__dirname, 'downloads'),
  startIndex: startIndex,
  endIndex: endIndex,
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

    // 启用下载事件监听并设置下载路径
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: CONFIG.downloadDir,
      eventsEnabled: true
    });

    console.log(`下载目录: ${CONFIG.downloadDir}`);

    console.log(`导航到 ${CONFIG.geminiUrl}...`);
    await page.goto(CONFIG.geminiUrl, { waitUntil: 'networkidle2' });
    await sleep(3000);

    console.log('等待页面加载...');

    // 查找所有对话卡片（class="library-item-card"）
    const conversationCards = await page.$$('div.library-item-card');
    console.log(`找到 ${conversationCards.length} 个对话`);
    console.log(`准备下载: 第 ${CONFIG.startIndex + 1} 到第 ${Math.min(CONFIG.endIndex, conversationCards.length)} 个\n`);

    const actualStart = CONFIG.startIndex;
    const actualEnd = Math.min(CONFIG.endIndex, conversationCards.length);
    let downloadCount = 0;

    for (let i = actualStart; i < actualEnd; i++) {
      try {
        console.log(`\n处理第 ${i + 1}/${conversationCards.length} 个对话...`);

        // 只在第一次之后返回 mystuff 页面
        if (i > actualStart) {
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

        // 在点击前，先从缩略图 URL 提取唯一 token
        const thumbSrc = await cards[i].evaluate(el => {
          const img = el.querySelector('img.thumbnail');
          return img ? img.src : '';
        });
        // 提取 token 前缀：/gg/ 之后到第一个下划线
        let imageToken = '';
        const tokenMatch = thumbSrc.match(/\/gg\/([^_]+)/);
        if (tokenMatch) {
          imageToken = tokenMatch[1];
          console.log(`  缩略图 token: ${imageToken}`);
        } else {
          console.log(`  未能提取缩略图 token，将使用第一张图片`);
        }

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

        // 查找对话中的图片，优先用 token 匹配
        const allImages = await page.$$('img[src*="googleusercontent"]');
        console.log(`  找到 ${allImages.length} 张图片`);

        let targetImage = null;
        if (imageToken && allImages.length > 1) {
          for (const img of allImages) {
            const src = await img.evaluate(el => el.src);
            if (src.includes(imageToken)) {
              targetImage = img;
              console.log(`  ✓ 通过 token 匹配到目标图片`);
              break;
            }
          }
          if (!targetImage) {
            console.log(`  未匹配到 token，使用第一张图片`);
          }
        }
        if (!targetImage && allImages.length > 0) {
          targetImage = allImages[0];
        }

        const images = targetImage ? [targetImage] : [];

        if (images.length > 0) {
          // 移动到目标图片上（触发 hover）
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

            // 尝试下载，最多重试 2 次
            let downloadSuccess = false;
            for (let retry = 0; retry < 3 && !downloadSuccess; retry++) {
              if (retry > 0) {
                console.log(`  重试下载 (${retry}/2)...`);
              }

              await downloadButtons[2].button.click();

              // 等待下载提示出现
              console.log('  等待下载开始...');
              try {
                // 等待"正在下载"提示出现
                await page.waitForFunction(
                  () => {
                    const snackbar = document.querySelector('.mat-mdc-snack-bar-label');
                    if (!snackbar) return false;
                    const text = snackbar.textContent || '';
                    return text.includes('正在下载') || text.includes('Downloading') || text.includes('下载');
                  },
                  { timeout: 10000 }
                );
                console.log('  [下载] 下载已开始');

                // 等待"已下载"提示出现
                console.log('  等待下载完成...');
                await page.waitForFunction(
                  () => {
                    const snackbar = document.querySelector('.mat-mdc-snack-bar-label');
                    if (!snackbar) return false;
                    const text = snackbar.textContent || '';
                    return text.includes('已下载') || text.includes('Downloaded') || text.includes('Complete');
                  },
                  { timeout: 60000 }
                );

                downloadCount++;
                downloadSuccess = true;
                console.log(`  ✓ 下载完成 (${downloadCount}/${limit})`);

                // 等待提示消失
                await sleep(2000);

              } catch (error) {
                console.log('  ✗ 下载超时或失败');
              }
            }

            if (!downloadSuccess) {
              console.log('  ✗ 下载失败，已重试 2 次');
            }

          } else if (downloadButtons.length > 0) {
            // 如果只有一个或两个按钮，点击最后一个
            const lastButton = downloadButtons[downloadButtons.length - 1];
            console.log(`  点击最后一个下载按钮: ${lastButton.label}`);

            // 尝试下载，最多重试 2 次
            let downloadSuccess = false;
            for (let retry = 0; retry < 3 && !downloadSuccess; retry++) {
              if (retry > 0) {
                console.log(`  重试下载 (${retry}/2)...`);
              }

              await lastButton.button.click();

              // 等待下载提示出现
              console.log('  等待下载开始...');
              try {
                // 等待"正在下载"提示出现
                await page.waitForFunction(
                  () => {
                    const snackbar = document.querySelector('.mat-mdc-snack-bar-label');
                    if (!snackbar) return false;
                    const text = snackbar.textContent || '';
                    return text.includes('正在下载') || text.includes('Downloading') || text.includes('下载');
                  },
                  { timeout: 10000 }
                );
                console.log('  [下载] 下载已开始');

                // 等待"已下载"提示出现
                console.log('  等待下载完成...');
                await page.waitForFunction(
                  () => {
                    const snackbar = document.querySelector('.mat-mdc-snack-bar-label');
                    if (!snackbar) return false;
                    const text = snackbar.textContent || '';
                    return text.includes('已下载') || text.includes('Downloaded') || text.includes('Complete');
                  },
                  { timeout: 60000 }
                );

                downloadCount++;
                downloadSuccess = true;
                console.log(`  ✓ 下载完成 (${downloadCount}/${limit})`);

                // 等待提示消失
                await sleep(2000);

              } catch (error) {
                console.log('  ✗ 下载超时或失败');
              }
            }

            if (!downloadSuccess) {
              console.log('  ✗ 下载失败，已重试 2 次');
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

    // 检查并修复文件扩展名
    console.log('\n检查文件扩展名...');
    const files = fs.readdirSync(CONFIG.downloadDir);
    let fixedCount = 0;

    for (const file of files) {
      const filePath = path.join(CONFIG.downloadDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && !path.extname(file)) {
        // 文件没有扩展名，尝试检测文件类型
        const buffer = fs.readFileSync(filePath);

        // 检查文件头来判断类型
        let ext = '';
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          ext = '.png';
        } else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
          ext = '.jpg';
        } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
          ext = '.gif';
        } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
          ext = '.webp';
        } else {
          // 默认使用 .png
          ext = '.png';
        }

        const newPath = filePath + ext;
        fs.renameSync(filePath, newPath);
        console.log(`  重命名: ${file} -> ${path.basename(newPath)}`);
        fixedCount++;
      }
    }

    if (fixedCount > 0) {
      console.log(`\n已修复 ${fixedCount} 个文件的扩展名`);
    }

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
