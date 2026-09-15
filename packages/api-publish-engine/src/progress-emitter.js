// 进度上报系统 (提取自参考产品 SetProgressEvent/SetProgressNewEvent)
const { EventEmitter } = require("events");

const publishStatusEnum = {
  init: "init",
  uploading: "uploading",
  uploadSuccess: "uploadSuccess",
  uploadFail: "uploadFail",
  pushing: "pushing",
  pushSuccess: "pushSuccess",
  pushFail: "pushFail",
};

class ProgressEmitter extends EventEmitter {
  setProgress(percent, message, taskId) {
    this.emit("progress", {
      percent: Math.min(100, Math.max(0, percent)),
      message: message || "",
      taskId,
    });
  }

  setStatus(status, message, taskId) {
    this.emit("statusChange", {
      status,
      message: message || "",
      taskId,
    });
  }
}

module.exports = { ProgressEmitter, publishStatusEnum };