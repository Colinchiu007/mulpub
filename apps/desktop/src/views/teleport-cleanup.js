// TDD 第一步（红）：复现 Teleport 污染——批量 describe 在「无清场」下连跑失败的回归锁
//
// 该文件被 CreateView.test.js 通过相对路径 import 时共享其 mock 环境；
// 独立运行则作为「清场模式」的对照实验载体。
//
// 实验设计（对照）：
//   A. mountS2V 无清场 + 连续两个用例（切 files tab → 读 tab）→ 期望看到污染（红）
//   B. 加 afterTeleportCleanup() 后同样序列 → 期望干净（绿）
// 本文件只导出实验工具，真正断言在 test 里。
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

/**
 * Teleport 清场标准模式（本批要固化的基建）：
 * 1) flushPending：冲刷挂起微任务与宏任务（弹窗 transition / 迟到的 nextTick 队列）
 * 2) 清 body 残留 DOM（Teleport 目标）
 * 3) 再冲刷一次（清 body 可能触发的新一轮微任务）
 */
export async function afterTeleportCleanup() {
  await flushPending()
  document.body.innerHTML = ''
  await flushPending()
}

export async function flushPending() {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}
