function createServicesApi(ipcRenderer) {
  return {
    servicesGetStatus: () => ipcRenderer.invoke('services:get-status'),
    servicesRestart: (key) => ipcRenderer.invoke('services:restart', { key }),
  }
}

module.exports = { createServicesApi }
