// 任务并行池 (参考同类产品 TaskPool)

class TaskPool {
  constructor(opts) {
    this.concurrency = opts?.concurrency || 3;
    this._queue = [];
    this._active = 0;
    this._results = [];
    this._done = false;
  }

  add(task) {
    if (this._done) throw new Error("TaskPool already started");
    this._queue.push(task);
  }

  async waitAll(onProgress) {
    this._done = true;
    const total = this._queue.length;
    const promises = [];
    for (let i = 0; i < this.concurrency && i < total; i++) {
      promises.push(this._worker(i));
    }
    await Promise.all(promises);
    return this._results;
  }

  async _worker(id) {
    while (this._queue.length > 0) {
      const task = this._queue.shift();
      this._active++;
      try {
        const result = await task();
        this._results.push(result);
      } catch (err) {
        this._results.push({ error: err.message });
      }
      this._active--;
    }
  }
}

module.exports = { TaskPool };