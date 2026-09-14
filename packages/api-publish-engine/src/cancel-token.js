// CancelToken — 任务取消机制 (提取自参考产品)
class CancelToken {
  constructor() {
    this.isCancelled = false;
    this._listeners = [];
  }

  cancel() {
    this.isCancelled = true;
    this._listeners.forEach(fn => fn());
    this._listeners = [];
  }

  throwIfCancelled() {
    if (this.isCancelled) {
      /** @type {Error & {isCanceled?: boolean, code?: number}} */
      const err = new Error("Task cancelled");
      err.isCanceled = true;
      err.code = -999;
      throw err;
    }
  }

  onCancel(fn) {
    if (typeof fn === "function") this._listeners.push(fn);
  }
}

module.exports = { CancelToken };