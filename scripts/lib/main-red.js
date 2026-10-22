'use strict'
/**
 * main-red.js — 「主干红着就别往里合」的**判据本体**（纯函数，零依赖、不碰网络、不碰 git）。
 *
 * 为什么需要执行体（2026-10-19 实测）：AGENTS「PR 自动合并」判据第 2 条写的是
 * `gh pr checks` 零 pending、零 fail，这条比 GitHub 的 required 清单更严；而它当时只存在于散文里，
 * 每轮由会话临场判断。实测代价：一条**非 required** 的分片红（`QG Desktop Shards` 不在 ruleset 也不在
 * classic protection 的任何一份清单里）先随 `Gate Result` 恒 0 的窗口合进 main，main 转红后
 * 反过来把之后**每一个** PR 的 required `Gate Result` 判红 —— 两个 PR 被这条冻了约 40 分钟，
 * 而冻住它们的不是我的改动，是主干上别人的红。散文没挡住，是因为它要求的是"临场自觉"。
 *
 * 三条不可让的口径：
 * 1. **差集判归属**，不是"有红就拦"：`新红 = 本 PR 失败集 ∖ 主干失败集`。按**检查名**对齐是刻意的粒度
 *    选择，也是本判据的**已知局限**——同名红只证明"这条检查在主干上也红过"，不证明"红的是同一条用例"。
 *    名字级足够回答本案的那个问题（该不该由我修、能不能怪我），不够回答"这条红消了没"，
 *    所以 STOP_MAIN_RED 的出口只能是「有人去修 main」，不能是「把这条差集当已解释」。
 * 2. **主干红一律停手**，即使本 PR 全绿：往红的主干上合，等于把 required `Gate Result` 的红
 *    留给下一个会话（这正是本案的上游）。唯一出口是显式 `--allow-main-red "<归因>"`，且必须
 *    **逐条点名全部**主干红（第五轮 C3：只点一条就放行整批，等于把「我读过读数行」降级成
 *    「我提到过任意一条」）；语义仍是「本 PR 就是去修那一条红的」，**不豁免新增红**。
 * 3. **取不到读数一律按未证实**（fail-closed），不得读成"没有红"：pending、**任一侧**零检查、采集自身失败
 *    三种形态各占一档退出码。把工具的失明读成结论，是本仓「装饰性门禁」的同型。
 *
 * skipped 的处理：主干上 skipped 的格子**不进主干失败集**（它不是红），因此本 PR 若在格子上红，
 * 会被判**新增红**——这是想要的方向（docs-only push 短路的格子不是"已解释的红"）。
 */

const FAILED_STATES = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR', 'ACTION_REQUIRED']
const PENDING_STATES = ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED']
/**
 * commit status（非 check-run）的「还没结果」三态（第五轮 C7）。它们语义上是 pending，不是
 * 「形状不认识」——落进 unknown 会让闸门对任何接了 commit status 的外部 CI 恒判 rc=4、一次也拦不了。
 * 真未知枚举仍然落 unknown（fail-closed 不变）。
 */
const COMMIT_PENDING_STATES = ['EXPECTED', 'NO_STATE', 'STARTING']

const VERDICTS = {
  OK: 'OK',
  NEW_RED: 'NEW_RED',
  STOP_MAIN_RED: 'STOP_MAIN_RED',
  INCOMPLETE: 'INCOMPLETE',
  SELF_FAULT: 'SELF_FAULT',
}

/**
 * 归一一行检查。**两种形状在本仓都真实存在，必须都认**：
 *  - `gh pr checks --json name,state` ⇒ `{name, state}`，state 是大写枚举；
 *  - `gh api .../commits/<sha>/check-runs` ⇒ `{name, status, conclusion}`，status 是小写的
 *    `queued|in_progress|completed`，真正的结果在 `conclusion`（`success|failure|cancelled|timed_out|action_required`，未完成时为 null）。
 * 只认其一的写法会把另一种整形读成 `unknown`，而 `unknown` 既不算红也不算绿 ⇒
 * 「一条红都没找到」这种读数其实是探针失明（AGENTS：不得把工具的失明读成"没有红"）。
 */
const SKIPPED_STATES = ['SKIPPED', 'NEUTRAL', 'STALE']
function bucketOf (row) {
  const up = (v) => String(v == null ? '' : v).toUpperCase()
  const state = up(row && row.state)
  if (FAILED_STATES.includes(state)) return 'fail'
  if (PENDING_STATES.includes(state)) return 'pending'
  if (COMMIT_PENDING_STATES.includes(state)) return 'pending'
  if (SKIPPED_STATES.includes(state)) return 'skipped'
  if (state === 'SUCCESS') return 'pass'

  const con = up(row && row.conclusion)
  if (FAILED_STATES.includes(con)) return 'fail'
  if (SKIPPED_STATES.includes(con)) return 'skipped'
  if (con === 'SUCCESS') return 'pass'
  if (con) return 'unknown'

  // conclusion 缺席 ⇒ 唯一信息在 status；status=completed 却没有 conclusion ⇒ 形状不合合同，不猜
  const st = String((row && row.status) || '').toLowerCase()
  if (st === 'queued' || st === 'in_progress' || st === 'waiting' || st === 'requested') return 'pending'
  return 'unknown'
}

/** 检查名集合（只取 fail / pending；其余不参与差集） */
function namesBy (rows, bucket) {
  const out = new Set()
  for (const r of rows || []) {
    const n = String((r && r.name) || '').trim()
    if (!n) continue
    if (bucketOf(r) === bucket) out.add(n)
  }
  return out
}

/**
 * @param {{prRows:object[], mainRows:object[], mainSha?:string, prSha?:string, allowMainRed?:string|null, mainMoved?:{from:string,to:string}|null}} input
 *        prRows/mainRows 形态由采集层负责，本层只认 name + state|conclusion。
 *        mainMoved：读数期间主干 tip 移动（{from,to}）⇒ 基准作废，按未证实处理（2026-10-22）。
 */
function judge (input = {}) {
  const prRows = Array.isArray(input.prRows) ? input.prRows : null
  const mainRows = Array.isArray(input.mainRows) ? input.mainRows : null
  const allow = typeof input.allowMainRed === 'string' ? input.allowMainRed.trim() : ''

  if (!prRows || !mainRows) {
    return { verdict: VERDICTS.SELF_FAULT, code: 4, reason: '采集层没交出数组（判据自身故障，按未证实处理）', counts: null }
  }
  const prFail = namesBy(prRows, 'fail')
  const prPending = namesBy(prRows, 'pending')
  const prUnknown = namesBy(prRows, 'unknown')
  const mainFail = namesBy(mainRows, 'fail')
  const mainPending = namesBy(mainRows, 'pending')
  const mainUnknown = namesBy(mainRows, 'unknown')
  /** 读数期间主干 tip 移动（{from,to}）⇒ 基准作废，见下面 mainMoved 档 */
  const mainMoved = input.mainMoved || null
  // 计数在**每一个非顶层 SELF_FAULT 出口**都必须是实数：读数行里出现 `=?` 就等于「这次跑没算出来」，
  // 而它长得和「算出来是 0」几乎一样（本仓把后者读成通过过不止一次）。
  // 第六轮 i4：counts 里必须带 uncertain（被主干同名 pending 摘掉的那几条红）。此前它只活在
  // reason 的散文里，读数行与 counts 都没有 ⇒ 机器面对这一格完全失明。
  // 顺序约束：counts 闭包引用 uncertain，而 uncertain 在下面才算出来——所以**只有差集之后**的调用点
  // 能传 uncertain.length；差集之前的三档早退（无 PR 行 / unknown 非空 / 主干零读数）一律走默认 0，
  // 提前读会让闸门在 TDZ 上抛 ReferenceError（那是连 4 档都拿不到的崩法）。
  const counts = (newRedCount, uncertainCount) => ({
    prFail: prFail.size, mainFail: mainFail.size, newRed: newRedCount == null ? 0 : newRedCount, uncertain: uncertainCount == null ? 0 : uncertainCount,
    prUnknown: prUnknown.size, mainUnknown: mainUnknown.size, prPending: prPending.size, mainPending: mainPending.size,
  })

  if (prRows.length === 0) {
    // 第八轮 i1/i2：主干红是**既成事实**，不因 PR 侧取不到读数而降级成「无从判定」——那样操作者只会
    // 去等 runner，永远不会知道要有人修 main（第四轮 i2 是同一格换了个入口）。顺序本身就是判据：
    // 下面这条必须排在「PR 侧零读数 ⇒ INCOMPLETE」之前，`test(…第八轮 i1/i2)` 钉住它，变异 R19 钉住
    // 「把它挪回去」会怎么红。但 --allow-main-red 在这里**不够格**：豁免只豁免既有红，
    // 豁免不了一份「PR 侧根本没读数」，所以带豁免时仍走 INCOMPLETE(3)。
    if (mainFail.size > 0) {
      return {
        verdict: allow ? VERDICTS.INCOMPLETE : VERDICTS.STOP_MAIN_RED,
        code: allow ? 3 : 2,
        reason: (allow
          ? '主干红已按显式归因豁免，但本 PR 一条检查都没有 ⇒ 无从证明「没有新增红」，按未证实处理。'
          : '主干是红的，停手不合并（即使本 PR 取不到任何检查，主干红也是既成事实；往红的主干上合 = 把 required Gate Result 的红留给下一个会话）。')
          + ' 主干失败格子：' + [...mainFail].sort().join(', ')
          + '；本 PR 一条检查都没有（runner 离线或事件未排队）。'
          + (allow ? '' : ' 若本 PR 正是去修那条红的，显式加 --allow-main-red "<逐条点名全部主干红 + 归因>"。'),
        newRed: [], inherited: [], uncertain: [], mainFail: [...mainFail].sort(),
        counts: counts(0),
      }
    }
    return { verdict: VERDICTS.INCOMPLETE, code: 3, reason: '本 PR 一条检查都没有（runner 离线或事件未排队）——无从判定', counts: counts(0) }
  }
  // ⛔ 形状不认识 = 探针失明，不是「没有红」（QM6 第三轮 i1，Critical）。原版在全部行都落进 unknown 时
  //    一路走到最后一档打印「主干绿、本 PR 无红」并 exit 0——把「没测出来」读成「测出来是绿的」，
  //    正是本文件开头写要防的那个同型。unknown 一条都不许静默通过；主干侧同理。
  if (prUnknown.size > 0 || mainUnknown.size > 0) {
    return {
      verdict: VERDICTS.SELF_FAULT, code: 4,
      reason: '检查形状不认识（不在失败/未完成/跳过/成功四张表里）：PR 侧 ' + prUnknown.size
        + ' 条、主干侧 ' + mainUnknown.size + ' 条；示例 '
        + ([...prUnknown, ...mainUnknown].slice(0, 5).join(', ') || '<无名可列>')
        + '。宿主改了枚举就得先改 bucketOf——不得按「无红」放行。',
      counts: counts(0),
    }
  }
  // 第七轮 i7：无名行是这条判据的暗区——bucketOf(null) 归 unknown，但 namesBy 先按名字过滤，
  // 于是这类行「既不进 fail 也不进 unknown 集合」，读数会变成「一条红都没找到」。宿主少给一个
  // name 字段、或某一页返回了非对象，都必须按未证实出声，而不是按无红放行。
  const junkOf = (rows) => rows.filter((r) => !r || typeof r !== 'object' || Array.isArray(r) || !String(r.name || '').trim()).length
  const prJunk = junkOf(prRows)
  const mainJunk = junkOf(mainRows)
  if (prJunk + mainJunk > 0) {
    return {
      verdict: VERDICTS.SELF_FAULT, code: 4,
      reason: '有 ' + (prJunk + mainJunk) + ' 行无名或非对象（PR 侧 ' + prJunk + ' 条、主干侧 ' + mainJunk
        + ' 条）：这类行被 namesBy 的名字过滤挡住，不进任何集合，放任它就是「把探针失明读成无红」。' 
        + '一律按未证实处理——宿主改了字段名要先改采集层，不得在这里猜。',
      counts: counts(0),
    }
  }

  // ⛔ 主干侧零读数同样不是「主干绿」（第五轮 C1，Critical）。原版只给 PR 侧设了零检查档，
  //    mainRows=[] 时三个集合全空，一路走到最后一档打印「主干绿、本 PR 无红」并 exit 0——而
  //    「主干刚被推进、新 tip 的 check-runs 还没生成」正是本文件第 12 行写的真实形态（第四轮 i3
  //    那次就是为它把空文本从抛错改成 []）。没有基准时连「新增红」都归因不出来，一律未证实。
  if (mainRows.length === 0) {
    return {
      verdict: VERDICTS.INCOMPLETE, code: 3,
      reason: '主干一条检查都没有（主干新 tip 的检查尚未生成，或该 commit 上没有 check-runs）——'
        + '主干态未证实：既不得读成「主干绿」，也不得在没有基准时判「本 PR 新增红」。',
      counts: counts(0),
    }
  }
  // ⛔ 基准作废（读数期间主干 tip 移动）：差集不可归因 ⇒ 按未证实处理，且**不得**报新增红。
  //   位置纪律：这条 MUST 排在「新增红」判定**之前**——主干基准作废时，主干侧读数与 PR 侧读数
  //   不在同一棵树上，"这条红在主干上也有"这句话就失去了依据；把它读成「本 PR 新增红」= 把
  //   不可归因读成证据（2026-10-22 实测：主干 tip 在一次读数期间从 2f5c0a32f 移到 8da92948，
  //   闸门那次读数整个作废）。PR 侧已证实的红仍要点名，但不得据此判新增红。
  if (mainMoved && mainMoved.from && mainMoved.to && mainMoved.from !== mainMoved.to) {
    return {
      verdict: VERDICTS.INCOMPLETE, code: 3,
      reason: '主干在读数期间移动（' + String(mainMoved.from).slice(0, 9) + ' → ' + String(mainMoved.to).slice(0, 9)
        + '），本次主干基准作废：主干侧读数与 PR 侧读数不在同一棵树上，差集不可归因'
        + (prFail.size ? '；PR 侧已失败 ' + prFail.size + ' 条（' + [...prFail].sort().join(', ') + '）——**未判新增红**：基准已作废' : '')
        + (mainFail.size ? '；主干失败格子：' + [...mainFail].sort().join(', ') : '')
        + '。按未证实处理：重试耗尽仍不稳定时不得据此判绿。',
      // ⛔ `newRed` 在这一档是**「未计算」而不是「没有」**：差集缺基准时不可归因，
      //    把它写成空数组会让下游把「不可归因」读成「零新增红」（评审 i1）。
      //    机器可读的那一份放在 `prFailNames`（PR 侧已证实的失败名）——
      //    `counts.prFail` 一直是真的（`counts()` 从闭包取，不硬编码）。
      newRed: [], inherited: [], uncertain: [], mainFail: [...mainFail].sort(),
      prFailNames: [...prFail].sort(),
      newRedComputed: false,
      counts: counts(0, 0),
    }
  }
  // 差集要把主干侧 pending 按**名字**算进「不可归因」集（第四轮 i5）。两个方向都不能整批降级：
  // 主干同名检查还没落地时判「新增红」是把未证实当证据；而主干上一条**无关的** pending 若也
  // 触发整批 INCOMPLETE，「主干有 4 条在跑」就会让任何 PR 的红都判不出来——那是把拦换成不拦。
  const newRed = [...prFail].filter((n) => !mainFail.has(n) && !mainPending.has(n)).sort()
  const uncertain = [...prFail].filter((n) => mainPending.has(n)).sort()
  const inherited = [...prFail].filter((n) => mainFail.has(n)).sort()
  // 新增红**先于**任何 pending 判定（第三轮 i3）：一条已落地的红不会被「别的格子还没跑完」撤销。
  if (newRed.length > 0) {
    return {
      verdict: VERDICTS.NEW_RED, code: 1,
      reason: '本 PR 自己引入的红（主干上没有同名红）：' + newRed.join(', ')
        + (prPending.size ? '（PR 侧另有 ' + prPending.size + ' 条未完成，不影响这一条已被证明）' : '')
        + (uncertain.length ? '；主干同名未完成 ' + uncertain.length + ' 条按未证实处理，未计入新增红' : ''),
      newRed, inherited, uncertain, mainFail: [...mainFail].sort(),
      counts: counts(newRed.length, uncertain.length),
    }
  }
  // 主干确红 ⇒ STOP_MAIN_RED 必须**先于** PR 侧 pending（第四轮 i2）。原版在这里先读到 pending，
  // 于是「主干 3 条红 + PR 有 1 条在跑」被报成 INCOMPLETE 且只字不提主干红——「得有人去修 main」
  // 这个信号被自己的未完成态藏掉，而那正是本片存在的理由。
  if (mainFail.size > 0 && !allow) {
    return {
      verdict: VERDICTS.STOP_MAIN_RED, code: 2,
      reason: '主干是红的，停手不合并（往红的主干上合 = 把 required Gate Result 的红留给下一个会话）。'
        + ' 主干失败格子：' + [...mainFail].sort().join(', ')
        + (inherited.length ? '；本 PR 同名红 ' + inherited.length + ' 条属既有' : '')
        + (prPending.size ? '（PR 侧另有 ' + prPending.size + ' 条未完成，不改变这一档）' : '')
        + (uncertain.length ? '；另有 ' + uncertain.length + ' 条与主干同名未完成的红按未证实处理' : '')
        + '。若本 PR 正是去修那条红的，显式加 --allow-main-red "<点名哪几条 + 归因>"。',
      newRed, inherited, uncertain, mainFail: [...mainFail].sort(),
      counts: counts(0, uncertain.length),
    }
  }
  if (mainFail.size > 0 && allow) {
    // 豁免必须**点名**它豁免的是哪几条（第四轮 i4）。任意非空字符串即全量放行 = 「写个非空串」
    // 就是出口，而 AGENTS 写的出口是「本 PR 正是去修那条红的」。绑定取真实失败检查名：一条都没
    // 提到，说明按旗标的人没读过读数行 ⇒ 判 SELF_FAULT——不把「填了字」读成「做了裁决」。
    const matched = [...mainFail].filter((n) => mentionsName(allow, n)).sort()
    if (matched.length === 0) {
      return {
        verdict: VERDICTS.SELF_FAULT, code: 4,
        reason: '--allow-main-red 的归因文本没有点名任何一条主干失败检查（主干红：'
          + [...mainFail].sort().join(', ') + '）。豁免的作用域必须是「我确实看过这几条并决定放行」，'
          + '不是「我填了个非空字符串」。',
        counts: counts(0, uncertain.length),
      }
    }
    // 逐条点名才算裁决（第五轮 C3）：matched>=1 就放行，等于「提到过任意一条」豁免整批。
    const unnamed = [...mainFail].filter((n) => !mentionsName(allow, n)).sort()
    if (unnamed.length > 0) {
      return {
        verdict: VERDICTS.STOP_MAIN_RED, code: 2,
        reason: '--allow-main-red 只点名了 ' + matched.length + ' 条，主干仍有 ' + unnamed.length
          + ' 条红没人读过：' + unnamed.join(', ') + '。豁免的作用域是「逐条确认」，不是「提到过任意一条」。',
        newRed, inherited, uncertain, mainFail: [...mainFail].sort(), allowed: matched,
        counts: counts(0, uncertain.length),
      }
    }
    // 第九轮 i1（Critical，真洞）：走到这里只证明了「主干红被逐条点名」与「没有新增红」，
    // **没证明本 PR 已经被测过**——prPending>0 时那些格子还没跑完，"无新增红"只是"还没跑出红"。
    // 豁免的语义是「本 PR 正是去修那几条既有红」，不是「PR 侧不必有读数」。
    if (prPending.size > 0 || mainPending.size > 0) {
      return {
        verdict: VERDICTS.INCOMPLETE, code: 3,
        reason: '主干红已按显式归因点名（' + matched.join(', ') + '），但仍有检查未完成：PR 侧 '
          + prPending.size + ' 条、主干侧 ' + mainPending.size + ' 条 ⇒ 豁免的前提「本 PR 已被证明'
          + '没有新增红」还不成立，按未证实处理。',
        newRed, inherited, uncertain, mainFail: [...mainFail].sort(), allowed: matched,
        counts: counts(0, uncertain.length),
      }
    }
    return {
      verdict: VERDICTS.OK, code: 0,
      reason: '主干红已按显式归因放行（点名 ' + matched.length + ' 条：' + matched.join(', ')
        + '；本 PR 无新增红）：' + allow,
      newRed, inherited, uncertain, mainFail: [...mainFail].sort(), allowed: matched,
      counts: counts(0, uncertain.length),
    }
  }
  // 走到这里只剩「有格子没跑完」这一种未证实：PR 侧或主干侧任一 pending 都算（i3/i5 收口在此）。
  if (prPending.size > 0 || mainPending.size > 0) {
    return {
      verdict: VERDICTS.INCOMPLETE, code: 3,
      reason: '仍有检查未完成：PR 侧 ' + prPending.size + ' 条'
        + (mainPending.size ? '、主干侧 ' + mainPending.size + ' 条（主干基准不稳 ⇒ 归因未证实）' : '')
        + (uncertain.length ? '；其中 ' + uncertain.length + ' 条同名红按未证实处理' : '') + '。',
      counts: counts(0, uncertain.length),
    }
  }

  return {
    verdict: VERDICTS.OK, code: 0,
    reason: '主干绿、本 PR 无红',
    newRed: [], inherited: [], mainFail: [],
  // 最后一档（OK）也必须走 counts()：原先写死 `prFail: 0, mainFail: 0` 让新增的 unknown 两个键直接缺席，
  // 读数行于是打印 `unknown=?/?`——而 `?` 与 `0` 快扫一眼几乎同形，本文件第 93 行那条纪律自己得先守住。
    counts: counts(0, uncertain.length),
  }
}

/**
 * 归因文本是否**逐字点名**了这条检查（第五轮 C3 附带）。
 * 检查名本身含空格 ⇒ 空白不能当右边界，否则 'Gate Result' 会在 'Gate Result 2' 里命中，
 * 把一条没人读过的红静默豁免。右边界只认标点与串尾；宁可逼人把归因写清楚，也不放过相邻键名。
 * @param {string} text 归因原文 @param {string} name 主干失败检查名
 */
function mentionsName (text, name) {
  const t = String(text == null ? '' : text)
  const n = String(name == null ? '' : name)
  if (!n) return false
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(^|[,，、;；：（【\\s])' + esc + '([,，、;；：）】]|$)')
  return re.test(t)
}

/** 单行现场读数——每次跑都必须打印，让下一个读者知道这次测了什么。 */
function readout (v, meta) {
  const c = v.counts || {}
  return 'MAIN-RED verdict=' + v.verdict + ' exit=' + v.code
    + ' main=' + ((meta && meta.mainSha) || '<none>')
    + ' pr=' + ((meta && meta.prSha) || '<none>')
    + ' prFail=' + (c.prFail == null ? '?' : c.prFail)
    + ' mainFail=' + (c.mainFail == null ? '?' : c.mainFail)
    + ' newRed=' + (c.newRed == null ? '?' : c.newRed) + ' uncertain=' + (c.uncertain == null ? '?' : c.uncertain)
    + ' unknown=' + (c.prUnknown == null ? '?' : c.prUnknown) + '/' + (c.mainUnknown == null ? '?' : c.mainUnknown) + ' prPending=' + (c.prPending == null ? '?' : c.prPending)
    + ' allow=' + ((meta && meta.allowMainRed) ? 'yes' : 'no')
}

/**
 * 解析 `owner/repo`。**不得依赖 `gh config get host`**——该键未设置时 gh 直接 rc=1
 * （`could not find key "host"`），拿它当必经步骤会让整道闸门恒判 SELF_FAULT，
 * 而"闸门永远红"比"闸门漏判"更快暴露，所以第一版就在自己的 PR 上被当场撞出来了。
 * 顺序：显式 --repo > `GH_REPO` > `git remote get-url origin` 解析 > 兜底默认。
 * @param {{explicit?:string, ghRepoEnv?:string, remoteUrl?:string, fallback?:string}} src
 * @returns {{slug:string|null, via:string}}
 */
function resolveRepoSlug (src = {}) {
  const clean = (v) => String(v || '').trim()
  if (clean(src.explicit)) return { slug: clean(src.explicit), via: '--repo' }
  if (clean(src.ghRepoEnv)) return { slug: clean(src.ghRepoEnv), via: 'GH_REPO' }
  const url = clean(src.remoteUrl)
  if (url) {
    // 支持 https://host/owner/repo.git、git@host:owner/repo.git、ssh://... 三种形态
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)
    if (m && /^[^/\s]+\/[^/\s]+$/.test(m[1])) return { slug: m[1], via: 'git-remote' }
    return { slug: null, via: 'git-remote-unparsed:' + url.slice(0, 60) }
  }
  if (clean(src.fallback)) return { slug: clean(src.fallback), via: 'fallback(必须是人显式认可的默认)' }
  return { slug: null, via: 'none' }
}

module.exports = { VERDICTS, FAILED_STATES, PENDING_STATES, SKIPPED_STATES, COMMIT_PENDING_STATES, bucketOf, namesBy, judge, mentionsName, readout, resolveRepoSlug }
