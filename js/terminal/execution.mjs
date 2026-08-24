export class ExecutionManager {
  #nextRunId = 1;
  #runs = new Map();
  #AbortController;

  constructor({ AbortControllerImpl = globalThis.AbortController } = {}) {
    this.#AbortController = typeof AbortControllerImpl === 'function' ? AbortControllerImpl : null;
  }

  run(execute, context, args, handlers = {}) {
    if (typeof execute !== 'function') throw new TypeError('Command execute must be a function');
    const runId = `run:${this.#nextRunId}`;
    this.#nextRunId += 1;
    const controller = this.#AbortController ? new this.#AbortController() : null;
    const signal = controller?.signal;
    this.#runs.set(runId, { controller, signal });
    handlers.started?.({ runId, signal });
    let value;
    try {
      value = execute({ ...context, signal }, args);
    } catch (error) {
      this.#reject(runId, error, handlers);
      return runId;
    }
    let then;
    try {
      then = value == null ? null : value.then;
    } catch (error) {
      this.#reject(runId, error, handlers);
      return runId;
    }
    if (typeof then === 'function') {
      let pending;
      try {
        pending = Promise.resolve(value);
      } catch (error) {
        this.#reject(runId, error, handlers);
        return runId;
      }
      try {
        pending.then(
          result => this.#resolve(runId, result, handlers),
          error => this.#reject(runId, error, handlers)
        );
      } catch (error) {
        this.#reject(runId, error, handlers);
      }
    } else {
      this.#resolve(runId, value, handlers);
    }
    return runId;
  }

  #resolve(runId, result, handlers) {
    if (!this.#runs.has(runId)) return;
    handlers.resolved?.({ runId, result });
  }

  #reject(runId, error, handlers) {
    const run = this.#runs.get(runId);
    if (!run) return;
    handlers.rejected?.({ runId, error, aborted: run.signal?.aborted === true });
  }

  has(runId) { return this.#runs.has(runId); }

  finish(runId) { return this.#runs.delete(runId); }

  interrupt(runId) {
    const run = this.#runs.get(runId);
    if (!run) return false;
    this.#runs.delete(runId);
    try { run.controller?.abort(); } catch { /* Abort is optional. */ }
    return true;
  }

  dispose() {
    for (const runId of [...this.#runs.keys()]) this.interrupt(runId);
  }
}
