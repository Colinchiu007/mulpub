function createIdentityApi(ipcRenderer) {
  return {
    identityGetState: () => ipcRenderer.invoke('identity:get-state'),
    identitySignIn: () => ipcRenderer.invoke('identity:sign-in'),
    identitySwitchAccount: () => ipcRenderer.invoke('identity:switch-account'),
    identitySignOut: () => ipcRenderer.invoke('identity:sign-out'),
    identitySessions: () => ipcRenderer.invoke('identity:sessions'),
    identitySessionsRevokeOthers: () => ipcRenderer.invoke('identity:sessions-revoke-others'),
    identityNotifications: () => ipcRenderer.invoke('identity:notifications'),
    identityNotificationsMarkRead: () => ipcRenderer.invoke('identity:notifications-mark-read'),
    onIdentityStateChanged: (callback) => {
      const handler = (_event, state) => callback(state)
      ipcRenderer.on('identity:state-changed', handler)
      return () => ipcRenderer.removeListener('identity:state-changed', handler)
    },
  }
}

module.exports = { createIdentityApi }
