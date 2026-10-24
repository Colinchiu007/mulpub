'use strict'

function createTtsVoiceCloneApi (ipcRenderer) {
  return {
    ttsVoiceClone: {
      requirements: (input) => ipcRenderer.invoke('tts-voice-clone:requirements', input),
      chooseSamples: (input) => ipcRenderer.invoke('tts-voice-clone:choose-samples', input),
      list: (input) => ipcRenderer.invoke('tts-voice-clone:list', input),
      add: (input) => ipcRenderer.invoke('tts-voice-clone:add', input),
      deleteClone: (input) => ipcRenderer.invoke('tts-voice-clone:delete', input),
      rename: (input) => ipcRenderer.invoke('tts-voice-clone:rename', input),
      // change: hifly-voice-edit-ui —— 修改克隆音色的语速/音量/语调。
      editParams: (input) => ipcRenderer.invoke('tts-voice-clone:editParams', input),
    },
  }
}

module.exports = { createTtsVoiceCloneApi }
