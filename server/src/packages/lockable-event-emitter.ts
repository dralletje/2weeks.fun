export class LockableEventEmitter<T> {
  #listener: ((value: T) => void) | null = null;

  on(listener: (value: T) => void, options: { signal: AbortSignal }) {
    if (this.#listener != null) {
      throw new Error("SingleEventEmitter only supports one listener");
    }

    this.#listener = listener;

    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        this.#listener = null;
      });
    }
  }

  get has_listener() {
    return this.#listener != null;
  }

  emit(value: T) {
    if (this.#listener == null) {
      throw new Error("SingleEventEmitter has no listener");
    }

    this.#listener(value);
  }
}
