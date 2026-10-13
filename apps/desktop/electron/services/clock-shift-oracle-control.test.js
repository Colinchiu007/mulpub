'use strict';

/**
 * oracle 的正控（阳性对照）：**位移那趟必须真的被位移了**。
 *
 * 没有这条，`check-clock-shift-oracle.js` 的 "PASS：零新增红" 有两种读法：
 * ① 该域内确实没有随墙上时钟老化的用例；② `MP_TEST_NOW_SHIFT_MS` 那套补丁根本没装上，
 * 于是第二趟只是把基线重跑一遍。这两种读法在输出上**完全一样**，而第 ② 种正是本仓
 * 反复踩过的「探测器自盲」（见 AGENTS.md「An observer must report its own blindness」同族）。
 *
 * 手法：`test-setup-clock-shift.js` 在替换 `Date` 之前先把**未位移的** `raw.now()` 存成
 * `baseNow`。本用例要求「位移开启时的当前时刻 ≥ baseNow + shiftMs」。
 * - 补丁生效 ⇒ `Date.now()` 本身就带 shift ⇒ 成立；
 * - 补丁没生效 ⇒ `Date.now() ≈ baseNow` ⇒ **必红**，即这条判据只对"探针坏了"敏感。
 * 关闭位移时（常态跑法）本用例直接 return —— 它不参与任何生产语义。
 */

describe('时钟位移 oracle 阳性对照', () => {
  it('开启位移时，Date.now() 必须确实落在 baseNow + shift 之后', () => {
    const info = globalThis.__mpClockShift;
    if (!info || !info.enabled) {
      // 常态跑法：没有位移可言。此处不得断言任何东西，否则本文件变成又一条常态约束。
      expect(info).toBeTruthy();
      return;
    }
    expect(typeof info.baseNow).toBe('number');
    expect(info.shiftMs).toBeGreaterThan(0);
    const drift = Date.now() - info.baseNow;
    // 允许 5s  slack：baseNow 与本次取值之间本来就跑了几毫秒代码；但 45 天的位移不可能被 5s 吃掉
    expect(drift).toBeGreaterThanOrEqual(info.shiftMs - 5000);
    expect(new Date().getTime() - info.baseNow).toBeGreaterThanOrEqual(info.shiftMs - 5000);
  });
});
