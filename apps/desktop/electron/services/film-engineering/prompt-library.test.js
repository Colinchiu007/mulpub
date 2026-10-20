// @ts-check
'use strict'
/**
 * prompt-library 契约测试（v7 批次一 F30）
 * 覆盖：正常加载 / 缺语种 / 缺文件 / 空文件 / 超大文件 / 路径穿越 / 任务名非法 /
 *       模板渲染（未提供变量保留原样 + missing 列表）/ 目录即契约（含真实 kit）
 * 测试固定使用 os.tmpdir() 下随机隔离目录，禁止触碰仓库内共享文件。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  LOCALES, REQUIRED_PARTS, MAX_PROMPT_FILE_BYTES, TASK_NAME_RE,
  resolveInside, validateTaskKey, listTasks, loadPromptLibrary, renderTemplate, getTaskPrompts,
} = require('./prompt-library')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lib-'))
}

function writeTask (root, task, locale, content) {
  const dir = path.join(root, task, locale)
  fs.mkdirSync(dir, { recursive: true })
  for (const part of REQUIRED_PARTS) {
    fs.writeFileSync(path.join(dir, part), content !== undefined ? content : `${task}/${locale}/${part}`, 'utf-8')
  }
}

function makeLib (tasks = ['adapt_script', 'filter_clips']) {
  const root = tmpDir()
  for (const t of tasks) {
    for (const loc of LOCALES) writeTask(root, t, loc)
  }
  return root
}

describe('prompt-library / 常量与 key 校验', () => {
  it('语言码闭集只有 zh / en（仓库不维护第三语种）', () => {
    expect(LOCALES).toEqual(['zh', 'en'])
  })

  it('每个任务必须同时具备 system.md 与 user.md', () => {
    expect(REQUIRED_PARTS).toEqual(['system.md', 'user.md'])
  })

  it('任务名非法一律拒绝（含 .. / 大写 / 空格 / 空串）', () => {
    for (const bad of ['..', '../etc', 'Adapt', 'a b', '', '1abc', 'a-b']) {
      const r = validateTaskKey(bad, 'zh')
      expect(r.ok).toBe(false)
    }
  })

  it('语言码非法一律拒绝', () => {
    for (const bad of ['fr', 'ja', 'ZH', '', 'zh-CN']) {
      const r = validateTaskKey('adapt_script', bad)
      expect(r.ok).toBe(false)
    }
  })

  it('合规任务名与语言码通过', () => {
    expect(validateTaskKey('adapt_script', 'zh').ok).toBe(true)
    expect(validateTaskKey('generate_shot_prompt', 'en').ok).toBe(true)
  })

  it('TASK_NAME_RE 不接受路径分隔符', () => {
    expect(TASK_NAME_RE.test('a/b')).toBe(false)
    expect(TASK_NAME_RE.test('a\\b')).toBe(false)
  })
})

describe('prompt-library / 路径越界防护（F33 精神）', () => {
  it('root 自身不算「之内」（相对路径为空）', () => {
    const root = tmpDir()
    const r = resolveInside(root, root)
    expect(r.ok).toBe(false)
  })

  it('.. 穿越被拒绝', () => {
    const root = tmpDir()
    const r = resolveInside(root, path.join(root, '..', 'outside.txt'))
    expect(r.ok).toBe(false)
  })

  it('root 内的正常路径通过并返回解析后的绝对路径', () => {
    const root = tmpDir()
    const r = resolveInside(root, path.join(root, 'a', 'b.md'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(path.isAbsolute(r.resolved)).toBe(true)
  })
})

describe('prompt-library / 加载（fail-closed）', () => {
  it('完整目录加载成功，任务名排序且确定性', () => {
    const root = makeLib(['zeta_task', 'alpha_task'])
    const r = loadPromptLibrary({ tasksRoot: root })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.library.taskNames).toEqual(['alpha_task', 'zeta_task'])
    expect(r.library.tasks.alpha_task.zh.system).toContain('alpha_task/zh/system.md')
    expect(r.library.tasks.alpha_task.en.user).toContain('alpha_task/en/user.md')
  })

  it('缺 en 语种 → 整体不可用（不允许静默退回中文）', () => {
    const root = makeLib(['adapt_script'])
    fs.rmSync(path.join(root, 'adapt_script', 'en'), { recursive: true, force: true })
    const r = loadPromptLibrary({ tasksRoot: root })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('PROMPT_LIBRARY_UNAVAILABLE')
    expect(r.error).toContain('en')
  })

  it('缺 user.md → 整体不可用', () => {
    const root = makeLib(['adapt_script'])
    fs.rmSync(path.join(root, 'adapt_script', 'zh', 'user.md'))
    const r = loadPromptLibrary({ tasksRoot: root })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('user.md')
  })

  it('空文件 → 整体不可用（空 prompt 比缺 prompt 更危险）', () => {
    const root = tmpDir()
    for (const loc of LOCALES) writeTask(root, 'adapt_script', loc)
    fs.writeFileSync(path.join(root, 'adapt_script', 'zh', 'system.md'), '   \n\t\n', 'utf-8')
    const r = loadPromptLibrary({ tasksRoot: root })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('内容为空')
  })

  it('超过大小上限 → 整体不可用', () => {
    const root = tmpDir()
    for (const loc of LOCALES) writeTask(root, 'adapt_script', loc)
    fs.writeFileSync(path.join(root, 'adapt_script', 'zh', 'system.md'), 'x'.repeat(MAX_PROMPT_FILE_BYTES + 1), 'utf-8')
    const r = loadPromptLibrary({ tasksRoot: root })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('上限')
  })

  it('tasksRoot 不存在 / 不是目录 / 为空 → 三种不可用形态分别出声', () => {
    const missing = loadPromptLibrary({ tasksRoot: path.join(tmpDir(), 'nope') })
    expect(missing.ok).toBe(false)

    const emptyRoot = tmpDir()
    const empty = loadPromptLibrary({ tasksRoot: emptyRoot })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain('没有任何任务目录')

    const lib = loadPromptLibrary({ tasksRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lib-')) + '/x' })
    expect(lib.ok).toBe(false)
  })

  it('tasksRoot 参数非法 → 拒绝', () => {
    expect(loadPromptLibrary({}).ok).toBe(false)
    expect(loadPromptLibrary({ tasksRoot: '' }).ok).toBe(false)
    expect(loadPromptLibrary({ tasksRoot: 123 }).ok).toBe(false)
  })

  it('listTasks 只列目录，忽略文件与非法名', () => {
    const root = makeLib(['ok_task'])
    fs.writeFileSync(path.join(root, 'stray.md'), 'x', 'utf-8')
    fs.mkdirSync(path.join(root, 'Bad-Name'))
    expect(listTasks(root)).toEqual(['ok_task'])
  })
})

describe('prompt-library / 模板渲染', () => {
  it('替换已提供的变量', () => {
    const r = renderTemplate('hi {{name}}, you are {{age}}', { name: 'Roko', age: 12 })
    expect(r.text).toBe('hi Roko, you are 12')
    expect(r.missing).toEqual([])
  })

  it('未提供的变量保留原样并进入 missing（不静默替换为空串）', () => {
    const r = renderTemplate('a {{x}} b {{y}}', { x: '1' })
    expect(r.text).toBe('a 1 b {{y}}')
    expect(r.missing).toEqual(['y'])
  })

  it('对象与数组变量序列化为 JSON', () => {
    const r = renderTemplate('{{obj}}', { obj: { a: 1 } })
    expect(r.text).toBe('{"a":1}')
  })

  it('null / undefined 替换为空串', () => {
    expect(renderTemplate('a{{x}}b', { x: null }).text).toBe('ab')
    expect(renderTemplate('a{{x}}b', { x: undefined }).text).toBe('ab')
  })

  it('非法变量名不参与替换', () => {
    const r = renderTemplate('{{Bad}} {{ok}}', { Bad: '1', ok: '2' })
    expect(r.text).toBe('{{Bad}} 2')
  })

  it('模板非字符串时返回空串且不抛', () => {
    expect(renderTemplate(null, {}).text).toBe('')
    expect(renderTemplate(123, {}).text).toBe('')
  })
})

describe('prompt-library / getTaskPrompts', () => {
  it('取到指定任务的 zh/en 原文', () => {
    const root = makeLib(['adapt_script'])
    const lib = loadPromptLibrary({ tasksRoot: root })
    expect(lib.ok).toBe(true)
    if (!lib.ok) return
    const r = getTaskPrompts(lib.library, 'adapt_script', 'en')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.system).toContain('adapt_script/en/system.md')
  })

  it('任务不存在 / 语言非法 / library 非法 → 分别出声', () => {
    const root = makeLib(['adapt_script'])
    const lib = loadPromptLibrary({ tasksRoot: root })
    expect(lib.ok).toBe(true)
    if (!lib.ok) return
    expect(getTaskPrompts(lib.library, 'ghost_task', 'zh').ok).toBe(false)
    expect(getTaskPrompts(lib.library, 'adapt_script', 'fr').ok).toBe(false)
    expect(getTaskPrompts(null, 'adapt_script', 'zh').ok).toBe(false)
  })
})

describe('prompt-library / 真实 film-kit 集成（目录即契约）', () => {
  const kitTasks = path.join(__dirname, '..', '..', 'film-kit', 'prompts', 'tasks')

  it('仓库内 film-kit/prompts/tasks 可加载且四个任务齐全', () => {
    const r = loadPromptLibrary({ tasksRoot: kitTasks })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.library.taskNames).toEqual([
      'adapt_script', 'filter_clips', 'generate_ai_transition', 'generate_shot_prompt',
    ])
  })

  it('每个任务的 zh/en 成对且 system/user 均非空（CI Gate 7 语义的前置）', () => {
    const r = loadPromptLibrary({ tasksRoot: kitTasks })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const task of r.library.taskNames) {
      const entry = r.library.tasks[task]
      for (const loc of LOCALES) {
        expect(typeof entry[loc].system).toBe('string')
        expect(typeof entry[loc].user).toBe('string')
        expect(entry[loc].system.trim().length).toBeGreaterThan(0)
        expect(entry[loc].user.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('转场任务的提示词包含「介质掩护」铁律（F31 的落地检查）', () => {
    const r = loadPromptLibrary({ tasksRoot: kitTasks })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.library.tasks.generate_ai_transition.zh.system).toContain('介质掩护')
    expect(r.library.tasks.generate_ai_transition.en.system.toLowerCase()).toContain('medium cover')
  })
})

// ===== v7 对抗评审 i2：符号链接越界必须拒绝 =====

describe('prompt-library / 符号链接越界（i2）', () => {
  it('resolveInside(resolveSymlinks) 对越界链接返回失败', () => {
    const root = tmpDir()
    const outside = tmpDir()
    fs.writeFileSync(path.join(outside, 'secret.md'), 'secret', 'utf-8')
    const linkPath = path.join(root, 'escape.md')
    let ok = true
    try {
      fs.symlinkSync(path.join(outside, 'secret.md'), linkPath, 'file')
    } catch {
      ok = false
    }
    if (!ok) return // Windows 无符号链接权限时跳过（不影响其它平台）
    const r = resolveInside(root, linkPath, { resolveSymlinks: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('符号链接越界')
  })

  it('root 内普通文件在 resolveSymlinks 下仍通过', () => {
    const root = tmpDir()
    const f = path.join(root, 'a.md')
    fs.writeFileSync(f, 'x', 'utf-8')
    const r = resolveInside(root, f, { resolveSymlinks: true })
    expect(r.ok).toBe(true)
  })

  it('链接目标不存在时 fail-closed（拿不到真实路径就不放行）', () => {
    const root = tmpDir()
    const linkPath = path.join(root, 'dangling.md')
    let ok = true
    try {
      fs.symlinkSync(path.join(tmpDir(), 'nope.md'), linkPath, 'file')
    } catch {
      ok = false
    }
    if (!ok) return
    const r = resolveInside(root, linkPath, { resolveSymlinks: true })
    expect(r.ok).toBe(false)
  })

  it('不传 resolveSymlinks 时保持词法语义（向后兼容）', () => {
    const root = tmpDir()
    const f = path.join(root, 'a.md')
    fs.writeFileSync(f, 'x', 'utf-8')
    expect(resolveInside(root, f).ok).toBe(true)
  })
})
