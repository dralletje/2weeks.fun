import { EventEmitter } from "node:events";

export class SingleEventEmitter<T> {
  emitter = new EventEmitter();
  locked = false;

  constructor() {
    this.emitter.setMaxListeners(Infinity);
  }

  on(listener: (value: T) => void, options: { signal: AbortSignal }) {
    if (this.locked) {
      throw new Error("SingleEventEmitter only supports one listener");
    }

    this.emitter.on("event", listener);
    this.locked = true;

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        this.emitter.removeListener("event", listener);
        if (this.emitter.listenerCount("event") === 0) {
          this.locked = false;
        }
      });
    }
  }

  [Symbol.asyncIterator]() {
    this.locked = true;
    return {
      next: () =>
        new Promise((resolve) => {
          this.emitter.once("event", (value) => {
            resolve({ value, done: false });
          });
        }),
      return: () => {
        this.locked = false;
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }

  emit(value: T) {
    this.emitter.emit("event", value);
  }
}
