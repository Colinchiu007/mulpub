// toast-assert-helpers.js — 测试侧的「用户看到哪句 toast」观察助手（单一实现）。
//
// 为什么需要它：主进程/渲染端的通知出口可以有两种合法写法 ——
//   ElMessage.warning('文案')              // 纯字符串
//   ElMessage.warning({ message: '文案', duration, grouping })  // 选项对象
// 断言若直接写死其中一种形态，出口一改写法就会整片假红，而"用户看到的话对不对"其实没变。
// 这里提供非对称匹配器，让断言只绑在**消息文本**上；两种形态同时通过，第三种形态（对象里没有 message）
// 一律不匹配 —— 那不是宽松，是把"没话"读成"有话"才是真正的假绿。
//
// 注意：本文件刻意不出现被观察对象的标识符，避免被"单点出口棘轮"当成调用点计数。
const textOf = (arg) => (typeof arg === 'string' ? arg : arg && typeof arg.message === 'string' ? arg.message : undefined)

export function messageIs (expected) {
  return {
    asymmetricMatch: (arg) => textOf(arg) === expected,
    toString: () => 'toast message equals ' + JSON.stringify(String(expected)),
  }
}

export function messageContains (sub) {
  return {
    asymmetricMatch: (arg) => { const t = textOf(arg); return typeof t === 'string' && t.includes(String(sub)) },
    toString: () => 'toast message contains ' + JSON.stringify(String(sub)),
  }
}

export function messageOf (arg) { return textOf(arg) }
