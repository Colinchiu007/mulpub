# Claude 有界审查：python-bridge 生命周期修复（2026-08-29）

> 审查方式：codeagent-wrapper --lite --backend claude，只读精确 diff
> diff：D:\Temp\mp-python-bridge-review-diff-20260829-final.txt（SHA256 509C138EC37BAFAC6CCF874274B9D200A2B1C7F51DFD65C971CE2F51EA809EB8）
> 会话：781c3214-e975-4886-9057-5ff0ce6405c5；模型实际读取 diff 并完成互锁推演；遇 API 429 限流多次退避后完成。
> 以下为规范化报告，原始 stdout 见文件尾部。

## 结论

无 Critical。核心互锁（_startingPromise / _intentionalStop / _intentionallyStoppedProcesses / isCurrentProcess）在事件循环单线程语义下自洽，未发现死锁、双启动或确定性孤儿进程路径。

## Warning（处理状态）

### W1 — 端口回退测试仅覆盖 spawn error，真实端口占用走 exit 路径（已处置）
- 位置：python-bridge.js error 处理器（EADDRINUSE/port → PORT_IN_USE → 上层回退端口）；测试「仅端口占用时回退」用 emit('error', EADDRINUSE) 验证。
- 事实：child_process 'error' 只在 spawn 失败时触发；真实端口占用是子进程 bind 失败后非零码 exit，走 waitForHealthy onExit → 'process exited before becoming healthy'，不会进入 PORT_IN_USE 回退。
- 处置：把原测试改名为「spawn 层失败」并加注释说明语义；新增「真实端口占用（子进程 exit）时不回退、拒绝且不静默继续」回归测试。python-bridge.integration.test.js 16/16 通过。

### W2 — 启动刚成功瞬间崩溃被 !_startingPromise 抑制重启（窄窗口，判定为 Info）
- 位置：exit 处理器重启条件含 !_startingPromise。
- 推演：isRunning=true 后 finally 清 _startingPromise 之间隔一个微任务；真实 Node 下子进程 exit 事件由 libuv 异步投递，几乎总在 finally 之后到达，窗口不可达。
- 处置：不改代码，记录为已知理论边缘。

## Info
- 启动中 stop 若遇 spawn 真正挂起，最多等 30s（spawn 超时）才继续；可接受。
- hasProcessExited 对伪造 EventEmitter 恒为 false，测试未覆盖"已退出不 kill"守卫；无害。
- spawn 前退出测试的"不二次 spawn"断言未覆盖新路径；无害。

## 双模型状态
- Claude：本报告（完成）。
- OpenCode：两轮均真实启动（opencode run -m opencode-go/deepseek-v4-flash），但无可用消费报告（首轮 wrapper 300s 超时；隔离轮被系统回收）。本轮未称完成，留待后续。

---
# 原始 stdout（wrapper 输出，含模型思考过程）


[codeagent-wrapper]
  Backend: claude
  Command: claude -p --dangerously-skip-permissions --setting-sources  --output-format stream-json --verbose -
  PID: 42944
  Log: D:\Temp\codeagent-wrapper-42944.log
  Session-ID: 781c3214-e975-4886-9057-5ff0ce6405c5
I need to finish analyzing the crash test, then write the report. Let me verify the exact createCrashingProc timing and the internal loop to settle the question of whether the test matches.

The key question: does the crash test actually reject with 'process exited before becoming healthy', or does it hit the health-check timeout path instead?

The exit event fires via setImmediate (a macrotask). The `await launchProcess(port)` resumes the internal loop as a microtask. In Node, after the 'spawn' setImmediate fires (macrotask), microtasks run before the next macrotask. But the internal loop's continuation is a microtask that only gets queued when `launchProcess`'s promise resolves — which happens synchronously inside the 'spawn' listener (settleResolve → resolve(proc)). So the resolution queues a microtask. After the 'spawn' macrotask completes, Node runs pending microtasks → internal continuation runs, sets pythonProcess=proc, currentPort, calls waitForHealthy(proc) which attaches `proc.once('exit', onExit)`. THEN the next macrotask 'exit' setImmediate fires → onExit fires → waitForHealthy rejects with 'process exited before becoming healthy'. 

So actually the exit fires AFTER waitForHealthy attaches (because the internal continuation is a microtask that runs before the next setImmediate macrotask). So `onExit` IS attached in time, and the test's expected error is correct.

Let me double check the ordering once more:
1. Test: `const start = bridge.startPythonBackend()` — starts internal, calls launchProcess → spawnSpy mock returns createCrashingProc. 
2. createCrashingProc: creates fake proc, schedules setImmediate#1 ('spawn' emit) [note: removeAllListeners('spawn') removes nothing since no listener yet on that event... actually the emit schedules regardless], schedules setImmediate#2 ('exit' emit).
3. launchProcess sets up spawn listener and returns the Promise. Internal awaits launchProcess.
4. Event loop: setImmediate#1 fires → proc.emit('spawn') → spawn listener → spawned=true, settleResolve → resolve(proc), queues internal continuation microtask.
5. Microtask: internal continuation runs → `_intentionalStop` false → pythonProcess=proc, currentPort, `await waitForHealthy(proc)` → waitForHealthy attaches `proc.once('exit', onExit)` and starts interval. Returns promise; internal awaits it (queues more microtasks).
6. setImmediate#2 fires → proc.emit('exit', 1) → waitForHealthy's onExit → finish('process exited before becoming healthy') → reject. Also launchProcess's exit handler runs (isCurrentProcess false since pythonProcess=proc now... wait pythonProcess IS proc now). 

Hold on — step 5 set `pythonProcess = proc`. So in step 6, the exit handler in launchProcess: `isCurrentProcess = pythonProcess === proc` → TRUE. `wasRunning = isRunning` = false (not yet healthy). `!spawned` → spawned is true, so not that branch. Restart condition: `isCurrentProcess && wasRunning(false) && ...` → wasRunning false → no restart. Good. isCurrentProcess true → `isRunning = false; pythonProcess = null`. But wait, isRunning was false anyway.

So waitForHealthy rejects with 'process exited before becoming healthy' → internal catch: `if (pythonProcess === proc)` → pythonProcess===proc true → pythonProcess=null, isRunning=false. Then `if (proc && !hasProcessExited(proc)) forceTerminateProcess(proc)` — hasProcessExited: proc.exitCode — after 'exit' event, Node sets exitCode. But this is a fake EventEmitter, not a real ChildProcess, so `proc.exitCode` stays undefined! So hasProcessExited returns false → forceTerminateProcess(proc) called → adds to intentionallyStopped, win32 taskkill / posix kill. The test then checks spawnSync not re-called / kill. Actually the crash test doesn't assert on the kill. Fine.

Then e is 'process exited before becoming healthy', not PORT_IN_USE → lastErr=e, break, throw. start rejects with that. Test passes. Good — my earlier concern about ordering was resolved: the microtask ordering makes onExit attach before exit fires. The test IS authentic here (real event-loop ordering).

Wait, but one more check: does `proc.exitCode` get set on a fake emitter? No. So `hasProcessExited` returns false for all fake procs (they're EventEmitters, exitCode never set). This means forceTerminateProcess always runs on them. For the health-timeout test, that's expected (taskkill/kill asserted). For the crash test, forceTerminate runs but isn't asserted. Harmless.

But this reveals a **test-authenticity gap for `hasProcessExited`**: in real Node, a ChildProcess that exited has `exitCode`/`signalCode` set (they're set when 'exit' fires). The fake procs never set them, so the "don't kill already-exited" guard is never exercised by tests. Minor — Info.

Now, the crash test asserts `spawnSpy` called once after 2500ms wait. Since exit fired and no restart scheduled (wasRunning false / not intentionally... whatever), spawn not called again. Good.

Let me also verify the "spawn 前退出" test: `createExitBeforeSpawnProc` emits 'exit' but NOT 'spawn'. launchProcess: `!spawned` true → settleReject('exited before spawn'). internal catch: pythonProcess null (never set) → skip clear. `forceTerminateProcess(proc)` — proc is a plain EventEmitter, kill is vi.fn, no exitCode → hasProcessExited false → forceTerminate called (adds to WeakSet, taskkill/kill on fake). Then e='exited before spawn' → break → throw. Test asserts 'exited before spawn'. Good. The 20ms wait then checks no second spawn. But wait — this is a NON-crash path; no restart is scheduled anyway (spawn never happened, so exit handler's `!spawned` branch returned early). So the test confirms the early reject, but the "no second spawn" assertion doesn't really test anything new (there's no restart logic for pre-spawn exits). Weak but harmless — Info.

Now the concurrency-start test and stop-during-start test I've verified. The requestBackend-waits-start test: 
```js
mockHealthGetAfterAttempts(1)  // attempt 2 healthy
const start = bridge.startPythonBackend()
const request = bridge.requestBackend('GET', '/api/accounts')
await new Promise(resolve => setTimeout(resolve, 20))
expect(httpRequestSpy).not.toHaveBeenCalled()
...
```
requestBackend: `if (!isRunning && _startingPromise) await _startingPromise`. isRunning false, _startingPromise set → awaits. Meanwhile health check attempt 2 healthy → start resolves → request continues → http.request made. Test waits 20ms and asserts no http request yet (health check not done). This uses real timers and mockHealthGetAfterAttempts where attempts are setImmediate-driven. attempt 1 → 'bad', attempt 2 → 'ok'. First interval tick at 500ms (real). After 20ms, no health check done, so request pending. Asserts httpRequestSpy not called. Good, authentic.

But there's a subtle issue: `mockHealthGetAfterAttempts(1)` counts `_healthCheck` calls. The `_healthCheck` in waitForHealthy polls. But ALSO — does anything else call `_healthCheck`? The watchdog isn't started until healthy. So only waitForHealthy polls. attempts: tick1 (500ms) → attempt 1 → bad; tick2 (1000ms) → attempt 2 → ok → finish resolve. So healthy at ~1s. Good.

Now let me also double-check the stop-during-start test's win32 assertion. It checks `spawnSyncSpy` called with taskkill args. But in beforeEach, `spawnSyncSpy.mockReset().mockImplementation(() => ({status:0}))`. The stop-during-start test doesn't reset it again, and doesn't mock spawnSync — it relies on beforeEach. But the test's own `spawnSpy.mockImplementationOnce` overrides spawn. The assertion `spawnSyncSpy).toHaveBeenCalledWith('taskkill', ['/PID','12349','/F','/T'], {timeout:5000})` — forceTerminateProcess calls spawnSync('taskkill', ['/PID', String(12349), '/F', '/T'], {timeout:5000}). String(12349)='12349'. Matches. Good.

Now, is there a **deadlock risk** in stop-during-start? stop awaits `startingPromise` (P1). P1's internal: launchProcess resolves (after releaseSpawn), then `if (_intentionalStop) throw 'start cancelled'`. So P1 rejects quickly. stop's await resolves. No deadlock. But what if releaseSpawn is never called (spawn never resolves)? Then start never settles and stop hangs forever awaiting P1. In production, launchProcess has a 30s spawn timeout, so P1 eventually rejects → stop's await resolves after 30s. So worst case stop blocks 30s. Acceptable but worth noting: **stop during a genuinely hung spawn waits up to 30s before it can proceed.** Since stop is called by Electron main on app quit, a 30s stall on quit could be noticeable. **Info/Warning.**

Actually — is spawn timeout using real or fake timers? Real. So a hung spawn → 30s real delay before stop proceeds. In tests they use a gate, so it's immediate. This 30s worst-case stop latency is a real (pre-existing-ish, but the new await makes it new) behavior. I'll note as Info.

Let me also verify: **the stop-during-start path where `_startingPromise` is awaited but the start already succeeded.** stop called, pythonProcess is set, so stop does NOT await, terminates. Already analyzed — fine.

One more: **`startPythonBackend` returns early `if (isRunning) return` — but a restart is scheduled via `_restartTimer` and `_startingPromise` is null.** Fine.

**Potential issue: `_startingPromise` shared but `_intentionalStop` reset in `finally` of the FIRST caller only.** Since `_startingPromise === startPromise` guard, only the caller that owns it resets. Concurrent callers just `return _startingPromise` without running finally. Good — no double reset.

**Critical candidate: restart-after-healthy-crash suppressed by `!_startingPromise`.** I'll flag this as Warning (narrow window).

Let me also reconsider: **`waitForHealthy` sets a 30s timeout via `setTimeout`, but the interval ticks every 500ms using `checking` guard.** With fake timers in the 10s/12.5s test, `advanceTimersByTimeAsync(13000)` fires both interval and timeout timers. Timeout at 30s won't fire in 13s. Interval fires 26 times; attempt 25 succeeds. Good.

**One concern: the `checking` guard + `advanceTimersByTimeAsync`.** Each interval callback awaits `_healthCheck`. `mockHealthGetAfterAttempts` uses setImmediate to call cb and emit. In fake timers, setImmediate is faked and `advanceTimersByTimeAsync` runs them. But the interval callback is async and the next interval tick could fire while `checking` is true, skipping. With 26 ticks and needing 25, there's margin. Fine.

Now let me write the report. Let me assign line numbers. The diff's python-bridge.js new content — I'll reference the line numbers from the diff file (the `@@ -1,363 +1,490 @@` and the added lines). Since the diff is a unified diff, added-line numbers: I can approximate. Better to reference by the diff file line numbers where possible, but the task wants file:line. Since I only have the diff, I'll reference the diff file line numbers (D:\Temp\...txt:NNN) and describe the symbol. Actually the task says "每条给 file:line" — I'll give the source file's approximate line via the diff. Let me reference the diff file lines since that's what was given, and note the symbol.

Let me finalize findings:

**Critical:**
- None that are clear-cut critical? Let me reconsider the port fallback. It's a real functional gap but it's pre-existing and the diff didn't make it worse; the diff actually added a test claiming to validate it. I'll rate the test-authenticity as Warning, not Critical.

Actually, let me reconsider whether there's a genuine Critical. The `!_startingPromise` restart suppression — narrow window, Warning. 

Let me reconsider the **stop during startup where the process becomes healthy and isRunning set, then stop's non-awaiting path** — I traced it's consistent.

What about **`requestBackend` during a cancelled start throws 'start cancelled' to the renderer** — the renderer would see 'Python backend start cancelled' instead of 'not running'. Minor.

Hmm, is there a genuine deadlock? Consider stop called during start, and the start's `launchProcess` spawn timeout is cleared... no.

Actually, let me reconsider one **potential real deadlock**: `stopPythonBackend` awaits `startingPromise`, and inside `startPythonBackendInternal`, after the cancelled throw, the catch calls `forceTerminateProcess(proc)` which on win32 calls `spawnSync('taskkill', ...)`. That's synchronous and returns. Then throws. P1 rejects. stop resumes. No deadlock.

But what about stop being called from within the same flow that also needs the start to complete? E.g., the watchdog restart path: `await stopPythonBackend(); await startPythonBackend()`. If a start is in progress and watchdog calls stop, stop awaits the in-progress start (which is this very restart?). Could cause serialization but not deadlock.

I'm fairly confident there's no hard deadlock. I'll note the 30s stop-latency as Info.

Let me reconsider the **port-in-use detection being dead in production** more carefully, as it's my strongest finding. The diff kept `err.message.includes('EADDRINUSE') || err.message.includes('port')` in the 'error' handler. Node's child_process 'error' event: fires when the process could not be spawned. EADDRINUSE is not a spawn error in Node. So the PORT_IN_USE branch essentially never triggers with a real backend. When the port is genuinely in use, the real Python process starts (spawn succeeds) then fails to bind and exits — hitting the exit handler (isCurrentProcess path, wasRunning false → no restart) and then waitForHealthy's onExit → 'process exited before becoming healthy' → start fails WITHOUT port fallback. So the advertised port fallback (`PORT_FALLBACK_COUNT`) and its test are not representative of real port-in-use. **This is a solid Warning** — the feature may not work as intended, and the test validates only the mock. I'll rate Warning (could argue Critical since it's a claimed feature that doesn't work, but it's pre-existing behavior, and the diff's main goals don't depend on it).

Let me now also double check: the diff's own claim list mentions "端口回退" as a test. So the author believes it works. Good to flag.

Now compile. I'll give line references to the diff file (D:\Temp\...txt) with the symbol and note approximate source location.

Let me structure the report.</think>I have the full diff and have traced the key interleavings. Let me compile the report.

## 审查报告：python-bridge 生命周期修复

审查对象：`D:\Temp\mp-python-bridge-review-diff-20260829-final.txt`（python-bridge.js 增量 + 测试）。以下 line 指 diff 文件行号。

### Critical

未发现会引入死锁/双启动/确定性命中失败路径的 Critical 缺陷。并发合并、启动中停止、回收、主动停止标记的核心互锁逻辑（`_startingPromise`、`_intentionalStop`、`_intentionallyStoppedProcesses`、`isCurrentProcess` 守卫）在事件循环单线程语义下自洽，我逐一推演了 stop↔start、start↔start、exit↔replace 交错，均无硬死锁或确定性的孤儿进程路径。

### Warning

**W1 — 端口回退在真实环境基本不可达，测试只测了 mock 自身**
`python-bridge.js` 的 `error` 处理器（diff:538-548）保留 `err.message.includes('EADDRINUSE') || err.message.includes('port')` 触发 `PORT_IN_USE`。但 `child_process.spawn` 的 `'error'` 事件只在 spawn 本身失败时（ENOENT/EACCES 等）触发，**不会**因端口占用发出 `EADDRINUSE`（那是子进程内 socket bind 错误）。真实端口占用表现为：spawn 成功 → Python 启动后 bind 失败 → 以非零码 `exit`。该 exit 会走 `waitForHealthy` 的 `onExit` → reject `'process exited before becoming healthy'`，而非 `PORT_IN_USE` → `continue`，因此 `PORT_FALLBACK_COUNT` 回退实际上不会在真实故障里生效。测试「仅端口占用时回退」用 mock 直接 `emit('error', EADDRINUSE)`（diff:269）验证的是 mock 自身的分支，不是真实失败模式。若产品确实需要端口回退，应改为从 stderr/exit 里识别 bind 失败。非本次改动引入，但新增测试给了一个"已验证"的假象。

**W2 — 启动刚成功瞬间崩溃会被 `!_startingPromise` 抑制自动重启（窄窗口）**
exit 处理器的重启条件含 `!_startingPromise`（diff:568）。启动流程在 `isRunning = true`、`return` 后，`startPythonBackend` 的 `finally` 才清空 `_startingPromise`（diff:610-613），两者间隔一个微任务。若进程在"健康检查通过→isRunning=true→finally 清标记"之间的窗口内崩溃（`wasRunning=true` 成立），`_startingPromise` 仍非空 → 重启被抑制，而改动前的逻辑会正常 `scheduleRestart`。概率低（启动刚成功

---
SESSION_ID: 781c3214-e975-4886-9057-5ff0ce6405c5

