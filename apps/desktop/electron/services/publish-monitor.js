// @ts-check
/**
 * PublishMonitor — 发布后状态监控
 * 
 * 基于参考产品逆向分析的发布后状态查询（QueryStateTaskScheduler）：
 * - 发布完成后自动查询发布结果
 * - 轮询检查：草稿→已发布→审核中→已上线/驳回
 * - 失败重试 + 超时处理
 * 
 * 文件位置: apps/desktop/electron/publish-monitor.js
 */
const log = require('./logger')

const POLL_INTERVAL = 10000 // 10秒
const MAX_RETRIES = 12 // 最大重试次数 = 2分钟
const CHECK_URLS = {
  weibo: 'https://weibo.com/ajax/statuses/mymblog',
  douyin: 'https://creator.douyin.com/aweme/v1/list/',
  bilibili: 'https://api.bilibili.com/x/web-interface/archive/space',
  zhihu: 'https://www.zhihu.com/api/v4/articles',
  xiaohongshu: 'https://creator.xiaohongshu.com/api/content/list',
  kuaishou: 'https://cp.kuaishou.com/graphql',
  toutiao: 'https://mp.toutiao.com/profile_v4/graphic/publishing',
  youtube: 'https://www.googleapis.com/youtube/v3/videos',
}

/**
 * 创建发布监控任务
 * 
 * @param {object} task - { postId, platform, accountId, cookies, callback }
 * @returns {object} { taskId, stop } — stop() 取消监控
 */
function createMonitorTask (task) {
  const { postId, platform, cookies, callback, maxRetries = MAX_RETRIES } = task
  const pollUrl = CHECK_URLS[platform]
  
  if (!pollUrl) {
    log.warn('PublishMonitor', `No check URL for platform: ${platform}`)
    callback && callback({ status: 'skipped', message: '不支持的状态查询平台' })
    return { stop: () => {} }
  }
  
  let cancelled = false
  let retries = 0
  let timerId = null
  
  const poll = async () => {
    if (cancelled) return
    
    try {
      const result = await checkPublishStatus(platform, postId, cookies, pollUrl)
      
      if (cancelled) return
      
      if (result.status === 'published' || result.status === 'reviewed' || result.status === 'rejected') {
        callback && callback({ status: result.status, postId, raw: result.raw })
        return
      }
      
      if (result.status === 'failed') {
        callback && callback({ status: 'failed', postId, message: result.message })
        return
      }
      
      // still pending
      retries++
      if (retries >= maxRetries) {
        log.warn('PublishMonitor', `Timeout monitoring ${platform}:${postId} after ${maxRetries} retries`)
        callback && callback({ status: 'timeout', postId, message: '状态查询超时' })
        return
      }
      
      log.info('PublishMonitor', `Poll ${retries}/${maxRetries} for ${platform}:${postId} → ${result.status}`)
      timerId = setTimeout(poll, POLL_INTERVAL)
      // R28 修复：unref 让定时器不阻止进程退出
      if (timerId && timerId.unref) timerId.unref()
    } catch (e) {
      log.error('PublishMonitor', `Poll error for ${platform}:${postId}: ${e.message}`)
      retries++
      if (retries >= maxRetries) {
        callback && callback({ status: 'error', postId, message: e.message })
        return
      }
      timerId = setTimeout(poll, POLL_INTERVAL)
      // R28 修复：unref 让定时器不阻止进程退出
      if (timerId && timerId.unref) timerId.unref()
    }
  }
  
  // 启动监控
  timerId = setTimeout(poll, POLL_INTERVAL)
  // R28 修复：unref 让定时器不阻止进程退出
  if (timerId && timerId.unref) timerId.unref()
  
  return {
    stop: () => {
      cancelled = true
      if (timerId) clearTimeout(timerId)
    },
  }
}

/**
 * 检查发布状态
 */
async function checkPublishStatus (platform, postId, cookies, pollUrl) {
  try {
    const axios = require('axios')
    
    const response = await axios.get(pollUrl, {
      params: { id: postId },
      headers: { Cookie: cookies || '' },
      timeout: 15000,
    })
    
    const data = response.data
    const items = data?.data?.list || data?.items || [data?.data] || []
    
    for (const item of items) {
      if (String(item.id) === String(postId) || String(item.article_id) === String(postId)) {
        // 状态映射
        const statusMap = {
          published: ['published', 'online', 'published_at'],
          reviewed: ['reviewing', 'under_review', '审核中'],
          rejected: ['rejected', 'failed', '审核不通过'],
          draft: ['draft', '未发布'],
        }
        
        const itemStatus = item?.status || item?.state || item?.publish_status || ''
        const statusText = item?.status_text || ''
        
        for (const [status, keywords] of Object.entries(statusMap)) {
          if (keywords.some(k => String(itemStatus).includes(k) || statusText.includes(k))) {
            return { status, postId, raw: item }
          }
        }
        
        return { status: 'unknown', postId, raw: item, rawStatus: itemStatus }
      }
    }
    
    return { status: 'pending', postId }
  } catch (e) {
    return { status: 'error', postId, message: e.message }
  }
}

module.exports = {
  createMonitorTask,
  checkPublishStatus,
  POLL_INTERVAL,
  MAX_RETRIES,
}
