import { EventEmitter } from "node:events";

export class SingleEventEmitter<T> {
  emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(Infinity);
  }

  on(listener: (value: T) => void, options: { signal: AbortSignal }) {
    this.emitter.on("event", listener);
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        this.emitter.removeListener("event", listener);
      });
    }
  }

  emit(value: T) {
    this.emitter.emit("event", value);
  }
}
