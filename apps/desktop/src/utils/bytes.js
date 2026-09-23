/**
 * 字节数人性化显示（日志统计与缓存统计共用，抽离自 LogsSettings.vue，避免两处实现口径漂移）。
 * 口径：非有限值/0/负数一律 '0 B'；B 档取整，KB 及以上保留 2 位；最大档 GB。
 */
export function formatBytes (bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}
