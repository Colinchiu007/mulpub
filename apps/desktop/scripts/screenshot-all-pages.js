/**
 * Multi-Publish 全页面截图脚本
 * 遍历所有路由，逐页截图保存到 mp-round2/ 目录
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 并行 worktree 时 Vite 端口不再固定 5174：显式 TEST_URL 覆盖（见 learnings 截图连错旧 Vite 复盘）
const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174';
const OUTPUT_DIR = path.join(__dirname, '../../01-docs/ui-reference/screenshots/mp-round2');

// 所有路由（hash 模式）
const routes = [
  { path: '/', name: 'home' },
  { path: '/accounts', name: 'accounts' },
  { path: '/publish', name: 'publish' },
  { path: '/collection', name: 'collection' },
  { path: '/monitor', name: 'monitor' },
  { path: '/comments', name: 'comments' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/create', name: 'create' },
  { path: '/library', name: 'library' },
  { path: '/calendar', name: 'calendar' },
  { path: '/intelligence', name: 'intelligence' },
  { path: '/model-providers', name: 'model-providers' },
  { path: '/viral-analysis', name: 'viral-analysis' },
  { path: '/keywords', name: 'keywords' },
  { path: '/cloud-publish', name: 'cloud-publish' },
  { path: '/first-run', name: 'first-run' },
  { path: '/create/history', name: 'create-history' },
  { path: '/create/result', name: 'create-result' },
];

async function main() {
  // 确保输出目录存在
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN'
  });

  const page = await context.newPage();

  const results = [];

  for (const route of routes) {
    const url = `${BASE_URL}/#${route.path}`;
    console.log(`📸 截图: ${route.name} → ${url}`);

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      // 额外等待确保 Vue 组件渲染完成
      await page.waitForTimeout(1500);

      const filePath = path.join(OUTPUT_DIR, `${route.name}.png`);
      await page.screenshot({ path: filePath, fullPage: false });

      // 检查截图是否基本非空白（简单检查文件大小）
      const stats = fs.statSync(filePath);
      const isEmpty = stats.size < 5000; // 小于 5KB 可能是空白页

      results.push({
        name: route.name,
        path: route.path,
        file: filePath,
        size: stats.size,
        status: isEmpty ? '⚠️ 可能空白' : '✅ 正常'
      });

      console.log(`   ${isEmpty ? '⚠️ 可能空白' : '✅ 正常'} (${(stats.size / 1024).toFixed(1)}KB)`);
    } catch (err) {
      results.push({
        name: route.name,
        path: route.path,
        status: `❌ 错误: ${err.message}`
      });
      console.log(`   ❌ 错误: ${err.message}`);
    }
  }

  await browser.close();

  // 输出汇总
  console.log('\n=== 截图汇总 ===');
  for (const r of results) {
    console.log(`  ${r.status}  ${r.name} (${r.path})`);
  }

  const okCount = results.filter(r => r.status === '✅ 正常').length;
  console.log(`\n总计: ${okCount}/${results.length} 页面截图正常`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
