/**
 * UiField ↔ 表单控件之间的「受控元素 id」通道（UX 审计 4.3 / audit-29）。
 *
 * 为什么要有这一层：`<label>` 与它描述的控件之间必须有一条 `for`/`id` 关联，
 * 否则读屏用户听到的是"未关联的标签 + 一个无名输入框"，点击标签也不会聚焦控件。
 * 本仓此前有两种形态各错一半：
 *   ① `UiField` 的 `label` 绑 `:for="forId"`，但 `forId` 是**可选 prop**，绝大多数调用点没传
 *      ⇒ 渲染出 `for=""` 或无 `for` 的孤岛标签；
 *   ② 控件自己写死 `id` 的调用点几乎没有，因为 `UiInput` 连 `id` prop 都没有，
 *      `id` 会作为属性透传到根 `div` 上（**看起来写对了，实际没进 input**）。
 *
 * 现在改成：`UiField` 提供一个可写的 `Ref<string|null>`，控件（`UiInput`）在**没有显式 id** 时
 * 用自己生成的稳定 id 登记进来；`UiField` 的 `label` 只在**真的有控件认领之后**才输出 `for`。
 * 这条顺序是判据的核心：**宁可没有 for，也不能有一个指向不存在元素的 for** ——
 * 后者在辅助技术里比缺失更糟（它声明了一个关联，而那个关联是坏的）。
 *
 * 一个 UiField 里放多个控件时，第一个认领者拿到 `for`，其余控件仍有自己的 id 但不被标签指向 ——
 * 这与 HTML 语义一致（一个 label 只能描述一个控件），不是遗漏。
 */
export const UI_FIELD_CONTROL_ID = Symbol('ui-field-control-id')
