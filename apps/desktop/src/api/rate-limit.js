/**
 * rate-limit API - Electron IPC bridge for the black-box self-check.
 * Renderer must not touch window.electronAPI directly (frontend-consistency gate);
 * go through this src/api bridge.
 */
import { invokeWithFallback } from './electron-bridge'

export async function rateLimitSelfCheck(params) {
  return invokeWithFallback('rateLimitSelfCheck', { code: -1, message: 'electronAPI not available' }, params)
}
