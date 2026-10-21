# BUGFIX：`cli.test.js` 让 main push 长期红 —— 两个「测试自身的环境假设」（2026-10-20）

## 1. 症状

`quality-gate.yml` 在 main push 上报红，`QG Unit Tests`（连带 `Gate Result`）失败，点名
`@multi-publish/api-publish-engine:test`：

```
[API 测试] 通过：Vitest（45 个文件）      ← 495 例全过
API 发布引擎测试失败：cli.test.js         ← 就红在这一条
Failed tasks:
- @multi-publish/api-publish-engine:test
```

**关键在于它只在「包级 target」里红，单跑是绿的**：

| 运行方式 | 结果 |
| --- | --- |
| `node --test test/cli.test.js`（单跑） | **4/4 全过** |
| `nx run @multi-publish/api-publish-engine:test`（包级） | **3/4**，失败在 `starts server and responds to health` |
| 同上，且事先占住 4568 | **3/4**，红文案 `Timed out waiting for port 4568` |

因此 CI 红了两天也没人修：本地单跑永远绿，看日志只能看到一条「超时」，看不出到底是谁的问题。

## 2. 逃逸链（为什么没被拦住）

| 层级 | 是否拦住 | 原因 |
| --- | --- | --- |
| 单元测试（单文件） | ❌ | 单跑时端口空闲、`FORCE_COLOR` 未设置 ⇒ 两个缺陷都不可见 |
| 包级集成测试 | ⚠️ 拦住但被误读 | 只报 `Timed out`，而 timeout 既能是「服务起得慢」也能是「端口被占」，红文案没区分 |
| CI（main push） | ⚠️ 拦住但归因错 | 失败落在 `packages/api-publish-engine`，而同期在飞的工作都在这之外 ⇒ 被当成「别人的 flake」 |
| 代码审查 | ❌ | 两个缺陷都是**测试对环境的隐含假设**，读代码时不像错误：`'--port', '4568'` 与 `eq(err,'')` 看着都很正常 |

## 3. 根因：两个独立缺陷叠加

### 缺陷 A：硬编码端口 + 并发跑

```js
var proc = spawnCli(['--port', '4568', '--dry-run'], 'health-api-keys.json');
var body = await waitForPort(4568, 5000);
```

`nx` 的 `@multi-publish/api-publish-engine:test` 会把 **node:test 与 45 个 vitest 文件并发跑**。
端口一旦被同 job 内的其它测试/残留进程占住，CLI 子进程**绑定失败直接退出**，而 `waitForPort`
只会在 `req.on('error')` 上无限重试到超时 —— 于是报「等端口超时」而不是「端口被占」。

**确定性复现**（不依赖运气）：先占住 4568，再跑 ⇒ `Result: 3/4`，红文案与 CI 一字不差。

### 缺陷 B：`eq(err, '')` 把环境警告当失败

```js
eq(err, '');   // --help 的 stderr 必须逐字节为空
```

`nx` 会向子进程注入 `FORCE_COLOR`，而环境里同时存在 `NO_COLOR`，Node 于是往 **stderr** 打：

```
Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

**这条是环境噪音，不是 CLI 的问题**，但断言要求 stderr 为空 ⇒ 只在 nx target 内红（单跑不注入 `FORCE_COLOR`，所以绿）。

> 修缺陷 A 之后红点会自动「移到」缺陷 B —— 这是本次最值得记的一点：**同一个 target 的两处环境假设，
> 修好一处会让另一处暴露成新的首错**，看起来像「修了也没用」，实际是两层都缺。

## 4. 修法

| 处 | 改法 | 判据 |
| --- | --- | --- |
| 端口 | 新增 `pickFreePort()`：`net.createServer().listen(0,'127.0.0.1')` 由内核分配空闲端口，读回 `address().port` 后关闭。两条用例各自取一个 | 占住 4568/4569 后仍 6/6 |
| 等待 | `BOOT_TIMEOUT_MS = 15000`（原 5000）；失败时把**子进程 stderr 末 800 字**拼进错误 | 红文案能区分「端口被占」与「服务慢」 |
| `--help` 等待 | 3s → `BOOT_TIMEOUT_MS`（并发下 3s 不够，实测 `code=-1`） | 包级 target rc=0 |
| stderr 断言 | `eq(err,'')` → `eq(stripBenignNodeWarnings(err), '')`，**只剔除已点名的两类**（`NO_COLOR … FORCE_COLOR` 与其 `trace-warnings` 提示行） | 变异① 还原旧断言 ⇒ 包级红 |
| 防回归 | 新增一例**行扫描锁**：源码里凡同一行同时出现 `'--port'` 与 4 位固定端口即失败 | 变异② 硬编码回 4568 ⇒ 该锁与超时双双报错 |

**为什么不整段忽略 stderr**：整段吞掉会把真实报错一起吞掉 —— 与本仓 QM-1 启动验证第②层同一教训
（`stderr` 非空但未命中红线 ⇒ 判 `NEEDS_REVIEW`，不得直接判通过）。所以只白名单两类、逐行剔除，其余保留被断言看见。

## 5. 变异反证（摘掉修复必须当场红）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| ① `stripBenignNodeWarnings(err)` 还原成 `err` | 包级 target 红 | ✅ `[API 测试] 失败：cli.test.js` |
| ② `pickFreePort()` 还原成 `4568` + 占住该端口 | 超时红 | ✅ `Timed out waiting for port 4568 after 15000ms (last error: read ECONNRESET)`，`Result: 5/6` |
| 还原两处 | 全绿 | ✅ 单跑 `6/6`；包级 `NX Successfully ran target test`，rc=0 |

## 6. 影响面

- 只改 `packages/api-publish-engine/test/cli.test.js`（测试文件），零生产代码、零 API、零 UI。
- 因此 QM-1（打包）与 QM-4（视觉）判 N/A；QM-2 必检项不适用（无运行时代码变更）。
- 收益是**解除 main push 的常红**：此前每次 push 的 `QG Unit Tests` 都红，等于是给所有会话的收尾判据加了噪音。

## 7. 可迁移结论

1. **测试对环境的隐含假设（固定端口、stderr 为空、固定 sleep）是 flake 的结构性来源**，而且它们读起来完全不像错误。
2. **「单跑绿、包级红」必须当成待查缺陷，不能当成环境噪音**：它精确指向「并发或注入导致的前提失效」。
3. **修第一层会让第二层暴露成新的首错** —— 看到「修了还是红」时先确认是不是同一处的下一个前提，而不是回滚修复。
4. **红文案必须自证**：超时类失败要把子进程 stderr 带进错误里，否则下一个人拿到的只有「超时」两个字。
