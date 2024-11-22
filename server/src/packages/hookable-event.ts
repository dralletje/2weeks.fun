export type HookableEventHandler<T> = (value: T) => void | T;

export class HookableEvent<T> {
  #on: (
    event: HookableEventHandler<T>,
    options: { signal: AbortSignal }
  ) => void;
  constructor(
    on: (
      event: HookableEventHandler<T>,
      options: { signal: AbortSignal }
    ) => void
  ) {
    this.#on = on;
  }
  on(event: HookableEventHandler<T>, options: { signal: AbortSignal }) {
    return this.#on(event, options);
  }
}

export class HookableEventController<T> {
  #listeners = new Map<any, { run: (event: T) => T | void }>();

  listener() {
    return new HookableEvent(
      (listener: (value: T) => void, options: { signal: AbortSignal }) => {
        let id = {};
        this.#listeners.set(id, { run: listener });
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            this.#listeners.delete(id);
          });
        }
      }
    );
  }

  run(event: T) {
    let new_event = event;
    for (let listener of this.#listeners.values()) {
      let result = listener.run(new_event);
      if (result !== undefined) {
        new_event = result;
      }
    }
    return new_event;
  }
}
