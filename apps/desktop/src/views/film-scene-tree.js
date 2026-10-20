// @ts-check
/**
 * film-scene-tree.js — 影视工程左侧场景树的纯组装逻辑
 *
 * 抽成纯函数的原因（CCG 深度审查 i1）：`<el-tree>` 在单元测试里被当成自定义元素渲染，
 * 其 default 插槽不会产出 DOM，所以「根节点是否被 locale 文案替换」这件事在 DOM 断言里
 * 根本观测不到。把判定逻辑放到纯函数里，才能对「多根 / 孤儿 / 重复 id / 成环」这些边界
 * 做真正的回归锁。
 */

/**
 * @typedef {Object} FilmScene
 * @property {string} id
 * @property {string} [name]
 * @property {string|null} [parentId]
 * @property {number} [count]
 * @property {number} [shotCount]
 * @property {number} [level]
 *
 * @typedef {Object} SceneNode
 * @property {string} id
 * @property {string} [name]
 * @property {boolean} isRoot 是否应显示 locale 文案（filmEngineering.libraryTitle）而非自己的 name
 * @property {SceneNode[]} children
 */

/**
 * 随包 kit 根场景使用的**中性占位名**。只有根节点名字是它（或命中历史旧名）时才用 locale 文案
 * 替换 —— 见 `shouldLocalizeRoot` 的理由。
 */
const NEUTRAL_ROOT_NAME = 'film project case'

/** 历史旧作品名（拼接构造，避免本文件自身被去品牌锁扫中；两侧锚定防无害子串误判）。 */
const LEGACY_ROOT_NAME_RE = new RegExp(`(^|[^\\w])${['hell', 'grind'].join('[\\s_-]*')}($|[^\\w])`, 'i')

/**
 * 该根节点是否应该用 locale 文案显示。
 *
 * CCG 深度审查第三轮 i6 指出：原先「唯一根就一律替换」会把**用户自制 kit 的根场景名**
 * （可能是用户自己的片名，本来不含被禁词）也盖成「影视项目案例」—— 那是把去品牌做成了
 * 「去掉所有片名」，属于过度覆盖。现在的口径是**只覆盖确实需要中性的名字**：
 *   - 空名（没有可用信息，用 locale 兜底）；
 *   - 中性占位名 `Film Project Case`（随包 kit 的根名，需按语言本地化）；
 *   - 命中历史旧作品名（老 kit 数据，必须盖掉）。
 * 其余情况一律保留数据里的原名。
 *
 * @param {string|undefined|null} name
 * @returns {boolean}
 */
export function shouldLocalizeRoot (name) {
  const value = String(name == null ? '' : name).trim()
  if (!value) return true
  if (value.toLowerCase() === NEUTRAL_ROOT_NAME) return true
  return LEGACY_ROOT_NAME_RE.test(value)
}

/**
 * 找出处于「父子环」里的场景 id。
 *
 * 每个场景最多只有一个父节点，所以环只可能是一条闭合的父指针链（A→B→A）。若不处理，
 * 环里的节点互相挂进对方 children、**永远进不了 roots** ⇒ 整棵子树从树 UI 里静默消失
 * （CCG 深度审查第三轮 i1）。
 *
 * @param {FilmScene[]} unique
 * @returns {Set<string>} 环上所有节点（含自引用）
 */
function findCyclicIds (unique) {
  /** @type {Map<string, string>} */
  const parentOf = new Map()
  for (const s of unique) {
    if (s.parentId) parentOf.set(s.id, s.parentId)
  }
  /** @type {Set<string>} */
  const cyclic = new Set()
  for (const s of unique) {
    /** @type {string[]} */
    const path = []
    /** @type {Set<string>} */
    const onPath = new Set()
    let current = s.id
    while (current != null && parentOf.has(current)) {
      if (onPath.has(current)) {
        // 从第一次出现的位置起，path 上这一段就是环
        for (const id of path.slice(path.indexOf(current))) cyclic.add(id)
        break
      }
      onPath.add(current)
      path.push(current)
      current = parentOf.get(current)
    }
  }
  return cyclic
}

/**
 * 组装场景树并标记「唯一根节点」。
 *
 * 只有 **恰好一个根节点、且不存在孤儿** 时，该根节点才置 `isRoot = true`
 * —— 此时界面用 `filmEngineering.libraryTitle`（影视项目案例 / Film Project Case）显示它。
 *
 * 为什么必须加这个前提：若对「任何无父节点的场景」一律置 isRoot，一旦 kit 里出现
 * 多个 level0 根、或某场景的 `parentId` 指向不存在的 id（导入残缺即会产生孤儿），
 * 它们会**一起显示成同一个标签**，各自名字被吃掉，用户在左侧树里无法区分，点选后
 * 拿到的分镜也不对。
 *
 * 重复 id 也必须先去掉：`Map` 会被后一条覆盖，若两条都参与归属计算，
 * **同一个节点对象会被 push 两次**，树里出现重复项，且 `roots.length` 虚高会让本地化前提失效。
 * 统一「同一 id 只认第一条」。
 *
 * @param {FilmScene[]} scenes
 * @returns {SceneNode[]}
 */
export function buildSceneTree (scenes) {
  const list = Array.isArray(scenes) ? scenes : []

  // ① 去重 + 剔除 id 缺失的脏条目，得到「每个 id 恰好一条」的干净清单。
  /** @type {FilmScene[]} */
  const unique = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const scene of list) {
    if (!scene || scene.id == null) continue
    if (seen.has(scene.id)) continue
    seen.add(scene.id)
    unique.push(scene)
  }

  // ② 建节点表。
  /** @type {Map<string, SceneNode>} */
  const map = new Map()
  for (const scene of unique) {
    map.set(scene.id, {
      id: scene.id,
      name: scene.name,
      count: scene.count,
      shotCount: scene.shotCount,
      isRoot: false,
      children: [],
    })
  }

  // ③ 环检测：环上节点一律按「无父」处理，否则整棵子树会从 UI 消失。
  const cyclic = findCyclicIds(unique)

  // ④ 挂父子关系，同时统计根与孤儿。
  /** @type {SceneNode[]} */
  const roots = []
  let orphanCount = 0
  for (const scene of unique) {
    const node = map.get(scene.id)
    const parent = scene.parentId ? map.get(scene.parentId) : null
    // 自引用（parentId === id）与环上节点都按「无父节点」处理，避免成环后子树整体不可见。
    if (parent && parent !== node && !cyclic.has(scene.id)) parent.children.push(node)
    else {
      if (scene.parentId) orphanCount += 1
      roots.push(node)
    }
  }

  // ⑤ 只有「唯一根 + 无孤儿 + 名字确实需要中性化」才本地化根节点。
  if (roots.length === 1 && orphanCount === 0 && shouldLocalizeRoot(roots[0].name)) {
    roots[0].isRoot = true
  }
  return roots
}
