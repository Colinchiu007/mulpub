// @ts-check
/**
 * OfflineManager — 离线模式管理器
 *
 * 功能：
 * 1. 检测网络状态
 * 2. 缓存发布任务
 * 3. 网络恢复后通知前端重试
 * 4. 提供 IPC 接口供前端查询状态
 */

const fs = require("fs")
const path = require("path")
const log = require("./logger")
const { LEGACY_OWNER_SUBJECT } = require("./store-schema")

const OFFLINE_CACHE_FILE = "offline-publish-cache.json"
let _isOffline = false
 
const _retryQueue = []
let _mainWin = null
let _taskQueue = null
let _ownerSubjectProvider = null

function isThenable(value) {
  return value && typeof value.then === "function"
}

function normalizeOwnerSubject(ownerSubject) {
  if (typeof ownerSubject !== "string" || !ownerSubject.trim()) {
    throw new Error("离线任务无法识别当前用户")
  }
  return ownerSubject.trim()
}

function getCurrentOwnerSubject() {
  if (!_ownerSubjectProvider) return undefined
  try {
    return normalizeOwnerSubject(_ownerSubjectProvider())
  } catch (_) {
    return null
  }
}

function taskBelongsToOwner(task, ownerSubject) {
  if (!task || typeof task !== "object") return false
  if (ownerSubject === undefined) {
    return task.owner_subject === undefined || task.owner_subject === null || task.owner_subject === LEGACY_OWNER_SUBJECT
  }
  return ownerSubject !== null && task.owner_subject === ownerSubject
}

function getCachePath() {
  let userDataDir
  try {
    userDataDir = require("electron").app.getPath("userData")
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    userDataDir = process.env.USERPROFILE || "/tmp"
  }
  return path.join(userDataDir, OFFLINE_CACHE_FILE)
}

function getMainWindow() {
  if (_mainWin && !_mainWin.isDestroyed()) return _mainWin
  try {
    const wins = require("electron").BrowserWindow.getAllWindows()
    return wins[0] || null
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return null
  }
}

function setTaskQueue(tq) {
  _taskQueue = tq
}

function setOwnerSubjectProvider(provider) {
  if (provider !== null && provider !== undefined && typeof provider !== "function") {
    throw new TypeError("owner subject provider must be a function or null")
  }
  _ownerSubjectProvider = provider || null
}

/**
 * 把一条缓存条目展开为可入队的任务负载数组。
 *
 * 缓存写入形状与重放形状必须同源：渲染层（单篇与批量）写入的是**嵌套**形状
 * `{ targets: [{platform, accountId}], data }`，而历史实现的判据只看**扁平**
 * `task.platform && task.article` —— 两者不同源，嵌套条目 `platform` 为 undefined，
 * 于是被永久留在缓存、网络恢复后**永不重放**（静默堆积）。
 *
 * 本函数是两种形状的**唯一展开点**：扁平原样透传（存量缓存向后兼容），
 * 嵌套按 targets 逐条展开；无法识别的条目返回空数组（由调用方留缓存，不静默丢弃）。
 * @param {object} task
 * @returns {Array<{platform: string, article: object, accountId: string|null}>}
 */
function expandCachedTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return []
  if (typeof task.platform === "string" && task.platform.trim() &&
    task.article && typeof task.article === "object" && !Array.isArray(task.article)) {
    return [{ platform: task.platform, article: task.article, accountId: task.accountId || null }]
  }
  if (Array.isArray(task.targets) && task.data && typeof task.data === "object" && !Array.isArray(task.data)) {
    return task.targets
      .filter(function(target) {
        return target && typeof target.platform === "string" && target.platform.trim()
      })
      .map(function(target) {
        return {
          platform: target.platform,
          article: task.data,
          accountId: target.accountId || task.data.accountId || null,
        }
      })
  }
  return []
}

function processCachedTasks() {
  if (!_taskQueue || _isOffline) return 0
  const ownerSubject = getCurrentOwnerSubject()
  if (ownerSubject === null) return 0
  const allTasks = loadAllCache()
  const tasks = allTasks.filter(task => taskBelongsToOwner(task, ownerSubject))
  if (tasks.length === 0) return 0
  let count = 0
  const remainingTasks = allTasks.filter(task => !taskBelongsToOwner(task, ownerSubject))
  tasks.forEach(function(task) {
    // 形状展开唯一入口：扁平（存量）与嵌套（渲染层实际写入）都归一为逐 target 负载。
    const payloads = expandCachedTask(task)
    if (payloads.length === 0) {
      remainingTasks.push(task)
      return
    }
    try {
      for (const payload of payloads) {
        if (ownerSubject !== undefined) {
          if (typeof _taskQueue.addForOwner !== "function") {
            throw new Error("任务队列不支持租户隔离入队")
          }
          const enqueueResult = _taskQueue.addForOwner({ ...payload, owner_subject: ownerSubject }, ownerSubject)
          // 当前 TaskQueue 是同步入队。若未来改成异步，不能在 Promise 结果未知时删除缓存。
          if (isThenable(enqueueResult)) {
            Promise.resolve(enqueueResult).catch(error => {
              log.warn("offline", "Async re-queue failed: " + error.message)
            })
            throw new Error("任务队列重放必须同步完成")
          }
        } else {
          _taskQueue.add(payload)
        }
      }
      // 单个条目的全部 target 都入队成功才计入重放数、才从缓存移除；
      // 任一 target 失败则整条留缓存（不部分丢失、不虚报成功）。
      count += payloads.length
    } catch (error) {
      remainingTasks.push(task)
      log.warn("offline", "Failed to re-queue cached task: " + error.message)
    }
  })
  saveCache(remainingTasks)
  log.info("offline", "Re-queued " + count + " cached tasks after network restored")
  return count
}

function clearAllCached() {
  const ownerSubject = getCurrentOwnerSubject()
  if (ownerSubject === null) return false
  return saveCache(loadAllCache().filter(task => !taskBelongsToOwner(task, ownerSubject)))
}


function isOffline() {
  return _isOffline
}

function loadAllCache() {
  try {
    const cachePath = getCachePath()
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, "utf8")
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    }
  } catch (e) {
    log.error("offline", "Failed to load cache: " + e.message)
  }
  return []
}

function loadCache() {
  const ownerSubject = getCurrentOwnerSubject()
  if (ownerSubject === null) return []
  return loadAllCache().filter(task => taskBelongsToOwner(task, ownerSubject))
}

function saveCache(tasks) {
  try {
    const cachePath = getCachePath()
    const tmpPath = cachePath + ".tmp"
    fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2))
    fs.renameSync(tmpPath, cachePath)
    return true
  } catch (e) {
    log.error("offline", "Failed to save cache: " + e.message)
    return false
  }
}

function addToCache(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) return false
  const ownerSubject = getCurrentOwnerSubject()
  if (ownerSubject === null) return false
  const tasks = loadAllCache()
  const { owner_subject: _untrustedOwner, ...safeTask } = task
  tasks.push({
    ...safeTask,
    ...(ownerSubject === undefined ? {} : { owner_subject: ownerSubject }),
    cachedAt: new Date().toISOString(),
  })
  return saveCache(tasks)
}

function clearSuccessfulTasks() {
  const ownerSubject = getCurrentOwnerSubject()
  if (ownerSubject === null) return []
  const tasks = loadAllCache()
  const pending = tasks.filter(function(task) {
    return !taskBelongsToOwner(task, ownerSubject) || !task.success
  })
  saveCache(pending)
  return pending.filter(task => taskBelongsToOwner(task, ownerSubject))
}

function onNetworkChange(isOffline) {
  const wasOffline = _isOffline
  _isOffline = isOffline
  if (wasOffline && !isOffline) {
    log.info("offline", "Network restored, processing cached tasks")
    processCachedTasks()
    notifyFrontend()
  } else if (!wasOffline && isOffline) {
    // 阶段 1.7（audit-7）：此前只有「恢复」方向会推给渲染层，断网方向**没有出口** ——
    // 主进程明明知道掉线了（net.on("offline") 已注册），用户侧却全程静默，
    // 直到采集/发布报错才知道是网络问题。丢事件比丢状态更糟：这是有监听、无通道。
    log.info("offline", "Network lost, notifying frontend")
    notifyOfflineLost()
  }
}

function notifyOfflineLost() {
  const win = getMainWindow()
  if (!win) return
  try {
    win.webContents.send("offline:lost", {
      cachedCount: loadCache().length,
    })
  } catch (e) {
    log.warn("offline", "Failed to notify frontend of offline: " + e.message)
  }
}

function notifyFrontend() {
  const win = getMainWindow()
  if (win) {
    try {
      win.webContents.send("offline:restored", {
        cachedCount: loadCache().length,
      })
    } catch (e) {
      log.warn("offline", "Failed to notify frontend: " + e.message)
    }
  }
}

function startMonitoring(mainWin) {
  _mainWin = mainWin
  try {
    const net = require("electron").net
    if (net && typeof net.on === "function") {
      net.on("online", function() { onNetworkChange(false) })
      net.on("offline", function() { onNetworkChange(true) })
    }
    _isOffline = (typeof net.isConnected === "function") ? !net.isConnected() : false
  // eslint-disable-next-line no-unused-vars
  } catch (e) {
    _isOffline = false
  }
}

function getStatus() {
  return {
    offline: _isOffline,
    cachedCount: loadCache().length,
    cachedTasks: loadCache(),
  }
}

module.exports = {
  isOffline: isOffline,
  loadCache: loadCache,
  saveCache: saveCache,
  addToCache: addToCache,
  clearSuccessfulTasks: clearSuccessfulTasks,
  clearAllCached: clearAllCached,
  onNetworkChange: onNetworkChange,
  startMonitoring: startMonitoring,
  getStatus: getStatus,
  setTaskQueue: setTaskQueue,
  setOwnerSubjectProvider: setOwnerSubjectProvider,
  processCachedTasks: processCachedTasks,
}
