// @ts-check
/**
 * useCollectionVideoCreation.contract.test.js — 依赖契约锁（**不 mock** `@/api/publisher`）
 *
 * 为什么单独一个文件：本 composable 为躲「部分 mock 缺导出 ⇒ 挂载即崩」而改成
 * **命名空间 + 惰性取用**（见 composable 头注释），代价是「导出改名/删除」不再在
 * 编译期或 import 期报错，而是**推迟到真正调用流水线的那一刻**。
 * ⇒ 这里用**真实模块**（不 vi.mock）把 5 个必需导出钉死：改名/删除 ⇒ 本用例当场红，
 * 而不是在用户点「视频创作」时才炸。
 */
import { describe, it, expect } from 'vitest'
import * as publisherApi from '@/api/publisher'

const REQUIRED_EXPORTS = [
  'pipelineStartOrchestrated',
  'pipelineCancelRun',
  'pipelineGetRunContext',
  'onPipelineUpdate',
  'storeGetSetting',
  // 配置档案（「去发布」弹窗里选的那份）由采集页自己兑现：就地执行不再跳创作页，
  // 配置必须由本入口读取并套用，否则就是「选了等于没选」。
  'story2videoConfigProfileList',
]

describe('useCollectionVideoCreation 的 @/api/publisher 依赖契约', () => {
  it.each(REQUIRED_EXPORTS)('必须导出 %s（改名/删除即红，不推迟到调用时才炸）', (name) => {
    expect(typeof publisherApi[name], `@/api/publisher 缺少导出 ${name}`).toBe('function')
  })
})
