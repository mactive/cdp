import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pageUrl = process.argv[2];
if (!pageUrl) {
  console.error('用法: node page.js <对话页URL>');
  process.exit(1);
}

const CONFIG = {
  debuggerUrl: 'http://localhost:9222',
  downloadDir: path.join(__dirname, 'downloads'),
};

if (!fs.existsSync(CONFIG.downloadDir)) {
  fs.mkdirSync(CONFIG.downloadDir, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectExt(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return '.webp';
  return '.png';
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80);
}

// 等待下载目录出现新文件，返回新文件路径
function waitForNewFile(downloadDir, before, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const after = new Set(fs.readdirSync(downloadDir));
      for (const f of after) {
        if (!before.has(f) && !f.endsWith('.crdownload') && !f.endsWith('.tmp')) {
          return resolve(path.join(downloadDir, f));
        }
      }
      if (Date.now() > deadline) return reject(new Error('等待新文件超时'));
      setTimeout(check, 300);
    };
    check();
  });
}

function finalizeDownloadedFile(filePath, baseName) {
  const ext = path.extname(filePath) || detectExt(filePath);
  let finalName = `${baseName}${ext}`;
  let finalPath = path.join(CONFIG.downloadDir, finalName);
  let dedupe = 2;

  while (fs.existsSync(finalPath) && path.resolve(finalPath) !== path.resolve(filePath)) {
    finalName = `${baseName}_${dedupe}${ext}`;
    finalPath = path.join(CONFIG.downloadDir, finalName);
    dedupe++;
  }

  if (path.resolve(finalPath) !== path.resolve(filePath)) {
    fs.renameSync(filePath, finalPath);
  }

  return finalName;
}

function normalizeUnnamedDownloads() {
  const files = fs.readdirSync(CONFIG.downloadDir);

  for (const file of files) {
    if (path.extname(file) || file.endsWith('.crdownload') || file.endsWith('.tmp')) {
      continue;
    }

    const filePath = path.join(CONFIG.downloadDir, file);
    if (!fs.statSync(filePath).isFile()) continue;

    try {
      const finalName = finalizeDownloadedFile(filePath, file);
      if (finalName !== file) {
        console.log(`已整理历史下载文件: ${file} -> ${finalName}`);
      }
    } catch (error) {
      console.log(`跳过无法识别的历史文件: ${file} (${error.message})`);
    }
  }
}

async function main() {
  let browser;
  try {
    normalizeUnnamedDownloads();

    browser = await puppeteer.connect({
      browserURL: CONFIG.debuggerUrl,
      defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages[0];

    const client = await page.target().createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: CONFIG.downloadDir,
      eventsEnabled: true
    });

    console.log(`导航到: ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // 获取页面标题，优先从对话标题元素取，回退到 document.title
    const rawTitle = await page.evaluate(() => {
      const el = document.querySelector('span[data-test-id="conversation-title"]');
      return (el && el.textContent.trim()) || document.title;
    });
    const title = sanitizeFilename(rawTitle || 'gemini');
    console.log(`页面标题: ${title}\n`);

    // 滚动容器是 .chat-history-scroll-container，不是 window
    // 从底部向上滚动，触发所有懒加载
    console.log('滚动全页触发懒加载...');
    let lastScrollTop = -1;
    let sameCount = 0;
    while (sameCount < 3) {
      const scrollTop = await page.evaluate(() => {
        const container = document.querySelector('.chat-history-scroll-container');
        if (!container) return -1;
        container.scrollBy(0, -800);
        return container.scrollTop;
      });
      await sleep(1200);
      if (scrollTop === lastScrollTop) sameCount++;
      else { sameCount = 0; lastScrollTop = scrollTop; }
    }
    await sleep(1000);
    console.log('滚动完毕\n');

    // 收集所有图片的 src（去重）
    const allSrcs = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="https://lh3.googleusercontent.com/gg/"]');
      return [...new Set([...imgs].map(img => img.src))];
    });
    console.log(`找到 ${allSrcs.length} 张图片\n`);

    let downloadCount = 0;

    for (let i = 0; i < allSrcs.length; i++) {
      const src = allSrcs[i];
      console.log(`[${i + 1}/${allSrcs.length}]`);

      // 找到 img 元素，然后找同一个 overlay-container 里的下载按钮
      // 结构: overlay-container > button.image-button > img
      //       overlay-container > .generated-image-controls > ... > button[data-test-id="download-generated-image-button"]
      const btnHandle = await page.evaluateHandle((targetSrc) => {
        const imgs = document.querySelectorAll('img[src*="https://lh3.googleusercontent.com/gg/"]');
        for (const img of imgs) {
          if (img.src !== targetSrc) continue;
          // 找最近的 overlay-container 祖先
          const overlay = img.closest('.overlay-container');
          if (!overlay) continue;
          const btn = overlay.querySelector('button[data-test-id="download-generated-image-button"]');
          if (btn) return btn;
        }
        return null;
      }, src);

      const isValid = await btnHandle.evaluate(el => el !== null);
      if (!isValid) {
        console.log('  未找到下载按钮，跳过');
        continue;
      }

      // 滚动到按钮位置
      await btnHandle.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      await sleep(1500);

      // 下载前快照目录
      const beforeFiles = new Set(fs.readdirSync(CONFIG.downloadDir));

      // 直接用 JS 点击（绕过 CSS visibility/pointer-events 限制）
      await btnHandle.evaluate(el => el.click());

      let success = false;
      for (let retry = 0; retry < 3 && !success; retry++) {
        if (retry > 0) {
          console.log(`  重试 (${retry}/2)...`);
          await btnHandle.evaluate(el => el.click());
        }
        try {
          try {
            await page.waitForFunction(() => {
              const el = document.querySelector('.mat-mdc-snack-bar-label');
              if (!el) return false;
              const t = el.textContent || '';
              return t.includes('正在下载') || t.includes('Downloading') || t.includes('下载');
            }, { timeout: 10000 });
          } catch {
            console.log('  未观察到“开始下载”提示，继续检查文件...');
          }

          // 以文件实际落盘作为成功依据，不再依赖“已下载”提示条。
          const newFile = await waitForNewFile(CONFIG.downloadDir, beforeFiles, 65000);
          const finalName = finalizeDownloadedFile(newFile, `${title}_${i + 1}`);

          success = true;
          downloadCount++;
          console.log(`  ✓ 已保存: ${finalName} (累计 ${downloadCount})`);
          await sleep(1000);
        } catch (e) {
          console.log(`  ✗ 超时或失败: ${e.message}`);
        }
      }
      if (!success) console.log('  ✗ 下载失败');
    }

    console.log(`\n完成！共下载 ${downloadCount}/${allSrcs.length} 张图片到: ${CONFIG.downloadDir}`);

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
