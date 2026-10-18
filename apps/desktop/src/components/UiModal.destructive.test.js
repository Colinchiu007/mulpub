// @vitest-environment jsdom
/**
 * UiModal 安全默认值与「破坏性弹窗不得点遮罩即关」合同（UX-AUDIT-2026-10-17 阶段 0.3）
 *
 * 背景（audit-29）：UiModal 的三个安全默认值比它要替换的 Element Plus 更差 ——
 * trapFocus:false / closeOnEsc:false（EP 2.14.2 dialog.mjs 实测 closeOnPressEscape:true）。
 * 36 处调用点里 trap-focus 显式传参 0 次，于是 Tab 一路跑出弹窗到背后页面。
 *
 * closeOnOverlay 不在本 PR 翻转：外部评审（第二轮 w7）指出全局翻转会把「点遮罩关闭」
 * 这一常用手势从 33 个良性弹窗上拿走；而审计稿原定的「破坏性弹窗显式关遮罩」在本 PR
 * 实测后被撤回——三处承载点的关闭路径都是 cancel，不存在「遮罩=默认同意」。
 * 因此锁收敛为一条真风险不变量：**破坏性动作不得绑在关闭路径上**（见下面第二个 describe）。
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, config } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import UiModal from './UiModal.vue';

config.global.stubs = config.global.stubs || {};
config.global.stubs.Teleport = { template: '<div><slot /></div>' };
config.global.stubs.Transition = { template: '<div><slot /></div>' };

const SRC_ROOT = path.resolve(__dirname, '..');

/** 递归收集 .vue（不读不动的目录：读不动即抛错，不做静默跳过） */
function collectVueFiles (dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectVueFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/**
 * 抽出每个 <UiModal> 起始标签的属性串与其内部块。
 * 起始标签必须做引号感知的扫描：属性值里带 `>`（如箭头函数）会让朴素 `<UiModal([^>]*)>`
 * 在那个 `>` 处截断，该站点静默漏扫而「命中数下界」仍被其它站点满足。
 */
function extractModals (source) {
  const modals = [];
  const token = '<UiModal';
  let cursor = 0;
  while (true) {
    const start = source.indexOf(token, cursor);
    if (start === -1) break;
    let i = start + token.length;
    let quote = null;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '>') break;
    }
    if (quote) throw new Error('未闭合的引号：起始标签解析失败，判据本身有 Bug');
    const attrs = source.slice(start + token.length, i);
    const close = source.indexOf('</UiModal>', i);
    if (close === -1) {
      // 自闭合 <UiModal ... /> 没有内部块
      modals.push({ attrs, inner: '', selfClosing: attrs.trimEnd().endsWith('/') });
    } else {
      modals.push({ attrs, inner: source.slice(i + 1, close), selfClosing: false });
    }
    cursor = i + 1;
  }
  return modals;
}

// 「这个弹窗会把用户的数据/会话/文件删掉吗」——按动作语义判，不按文案情绪判
const DESTRUCTIVE_HANDLER = /@click[^=]*="[^"]*\b(delete|remove|clear|revoke|erase|destroy|purge)[A-Z_]?/i;

describe('UiModal 安全默认值', () => {
  it('默认值合同：trapFocus=true / closeOnEsc=true / closeOnOverlay=true', () => {
    const props = UiModal.props;
    expect(props.trapFocus.default).toBe(true);
    expect(props.closeOnEsc.default).toBe(true);
    // 良性弹窗保留「点遮罩关闭」手势（评审 w7）；破坏性弹窗由下面的逐点锁显式关掉
    expect(props.closeOnOverlay.default).toBe(true);
  });

  it('行为锁：不传参时按 Esc 会关闭（此前默认不关）', () => {
    const w = mount(UiModal, { props: { visible: true } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('行为锁：不传参时 Tab 焦点不得跑出弹窗', async () => {
    const w = mount(UiModal, {
      props: { visible: true },
      slots: { default: '<button data-testid="in-modal-a">A</button>' },
      attachTo: document.body,
      global: { stubs: { Teleport: false, Transition: false } },
    });
    await w.vm.$nextTick();
    // 真 Teleport 会把内容搬到 document.body，包装器内查不到
    const inside = document.querySelector('[data-testid="in-modal-a"]');
    expect(inside).not.toBeNull();
    inside.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    // 焦点必须仍留在弹窗内部（循环回第一个可聚焦元素），不得掉回 body
    expect(document.activeElement).not.toBe(document.body);
    w.unmount();
  });

  it('progress 变体仍豁免（modeless 观察窗不抢焦点、不注册全局键盘监听）', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    mount(UiModal, { props: { visible: true, variant: 'progress' } });
    const keydownAdds = spy.mock.calls.filter(c => c[0] === 'keydown').length;
    expect(keydownAdds).toBe(0);
    spy.mockRestore();
  });
});

describe('承载破坏性动作的 UiModal：关闭路径必须是「取消」而非「执行」（逐点结构锁）', () => {
  const files = collectVueFiles(SRC_ROOT);
  const sites = [];
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('<UiModal')) continue;
    for (const modal of extractModals(source)) {
      if (!DESTRUCTIVE_HANDLER.test(modal.inner)) continue;
      const rel = path.relative(SRC_ROOT, file);
      // @close 的处理表达式：遮罩点击 / Esc / X 按钮三条路都汇到这里
      const closeMatch = modal.attrs.match(/@close="([^"]*)"/);
      const closeExpr = closeMatch ? closeMatch[1] : '';
      sites.push(rel);
      // 真风险形状：把破坏性动作挂在「关闭」上 —— 用户想走开却把数据删了。
      // 审计稿 audit-29 原写「点遮罩即消失＝默认同意」，本 PR 实测三处承载点
      // （AccountGroupManager / AccountProxyDialog / CreateView 项目删除对话框）
      // 的关闭路径全部路由到 cancel，该断言不成立，故判据收敛为下面这条可机械检出的不变量。
      if (/\b(delete|remove|clear|revoke|erase|destroy|purge|confirm)[A-Za-z_]*\s*\(/i.test(closeExpr)) {
        offenders.push(`${rel} @close="${closeExpr}"`);
      }
    }
  }

  it('扫描域非空且确实找到了承载破坏性动作的弹窗（防「解析退化成空集合」的假绿）', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(sites.length).toBeGreaterThan(0);
  });

  it('没有任何破坏性弹窗把破坏动作绑在关闭路径上', () => {
    expect(offenders).toEqual([]);
    // 承载点清单只能缩小；新增承载点必须逐点核对关闭语义
    expect(sites.sort()).toEqual([
      'features\\accounts\\components\\AccountGroupManager.vue',
      'features\\accounts\\components\\AccountProxyDialog.vue',
      'views\\CreateView.vue',
    ].sort());
  });

  it('closeOnOverlay 默认值保持 true，但破坏性弹窗的取消语义由上一条锁守住', () => {
    expect(UiModal.props.closeOnOverlay.default).toBe(true);
  });
});
