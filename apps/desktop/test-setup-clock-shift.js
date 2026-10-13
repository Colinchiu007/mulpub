'use strict';

/**
 * vitest setupFile：把进程内的「现在」整体前移 MP_TEST_NOW_SHIFT_MS 毫秒。
 *
 * 动因（2026-10-13，PR #3459/#3460 的类级欠账）：本仓出现过一根「夹具写死绝对时间戳 +
 * 被测路径读真实时钟 + 窗口是相对量」的定时炸弹 —— 写下的当天绿、两天后必然红。
 * 静态形状规则经存量测量判定不可行（1326 个测试文件里 6 个候选红、逐条判读 0 真），
 * 因为"窗口参数有没有真的被时钟消费"不是形状能定的。所以这里换成**行为 oracle**：
 * 同一批用例跑两遍，第二遍把时钟推到未来，只有"结果随墙上时钟变"的用例会单独红。
 *
 * 为什么同时替 `Date` 与 `Date.now`：
 * - 只替 `Date.now` 会漏掉零参 `new Date()`（V8 里它走内部时钟，不经 `Date.now`）；
 * - 只替 `new Date()` 会漏掉本仓实际用的 `Date.now()`。
 * 两者都替，才配得上「把现在推后」这句话的字面含义。
 *
 * 刻意**不**用 `vi.useFakeTimers()`：那会把 `setTimeout` 一起冻结，全量套件里
 * 大量用例靠真实定时器等待，届时"红"与"探针把环境弄坏"不可区分（与本仓
 * 「反证必须先证明探针可信」同一条纪律）。
 */

const raw = Date;
const shiftMs = Number(process.env.MP_TEST_NOW_SHIFT_MS || 0);

function shiftedNow () {
  return raw.now() + shiftMs;
}

/**
 * 探针自身必须可自证生效：被替过几次、替了多少毫秒，全部记账并打印一次。
 * 否则「没有用例变红」既可能是"真干净"也可能是"补丁没装上"（同一族第三次落点）。
 */
class ShiftedDate extends raw {
  constructor (...args) {
    if (args.length === 0) {
      super(shiftedNow());
    } else {
      super(...args);
    }
  }

  static now () {
    return shiftedNow();
  }
}

if (shiftMs > 0) {
  globalThis.Date = ShiftedDate;
  globalThis.__mpClockShift = {
    enabled: true,
    shiftMs,
    baseNow: raw.now(),
    dateCtorPatched: ShiftedDate !== raw,
  };
  // 只打一行：这是"补丁装上了"的现场证据，出现在每个 worker 的 stdout 首部
  console.log(`[CLOCK-SHIFT] active shift_ms=${shiftMs} (~${Math.round(shiftMs / 86400000)}d)`);
} else {
  globalThis.__mpClockShift = { enabled: false, shiftMs: 0, baseNow: raw.now(), dateCtorPatched: false };
}
