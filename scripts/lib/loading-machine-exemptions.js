/**
 * 跨方法 loading 状态机的豁免登记表（R5 判据的人工确认面）。
 *
 * R5 是**函数级**判据：函数内置 true 且体内无复位 ⇒ 红。但有一类合法写法是**跨方法状态机**：
 * 置位在 A 方法，复位在 B 方法（如「秒开加载窗」模式：openLoading() 置位、open() 复位）。
 * 函数级判据覆盖不了这个语义，直接改宽就等于没有锁 —— 所以走本仓既有范式：
 * **由人确认后在此登记（带文件+状态名+机理解释），判据核对登记的正确性。**
 *
 * ⚠ 登记要求：
 * 1. 必须写清「谁置位、谁复位、复位路径是否覆盖所有分支」；
 * 2. 登记项是**文件+状态名**粒度；存在性由**测试**核对（same-type-risk-locks-r2.test.js 的一致性用例读文件断言 `NAME = true` 存在；重命名/搬文件 ⇒ 测试红 ⇒ CI 红）；判据运行时只做 path#name 匹配、不读盘；
 * 3. **agent 可以起草登记项，但必须带 pending_signoff: true；未签核的项不生效**（判据按未豁免照红）。
 *    签核 = 人工把该字段改为 false（或删除）—— 这是「agent 起草 / 人类生效」的机械分界。
 *    本表的现存登记项自创建起即为 pending_signoff: true，待用户签核（见 PR 描述）。
 *
 * 本轮首轮审计（2026-10-17）：全仓 27 处 loading=true 中仅此 1 处为跨方法状态机，
 * 已人工核对其复位路径（identity-auth-window.js open() L222-229 覆盖成功/销毁两分支）。
 */
module.exports = {
  CROSS_METHOD_LOADING_MACHINES: [
    {
      path: 'apps/desktop/electron/services/identity/identity-auth-window.js',
      name: '_pendingLoading',
      pending_signoff: false, // 已由用户签核（2026-10-17，回复 A）：核对 open() L222-229 复位两分支覆盖 + reset() L47/L75
      mechanism: 'openLoading() 置位（L202 复用分支提前 return / L206 创建后置位）；open() 在 L222-229 复位（窗口存活复用与销毁重建两分支都覆盖）；reset() 的 L47/L75 亦复位',
    },
  ],
}
