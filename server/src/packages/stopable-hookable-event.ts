export type HookableEventHandler<T> = (value: T) => void | T | null;

export class StoppableHookableEvent<T> {
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

export class StoppableHookableEventController<T> {
  #listeners = new Map<any, { run: (event: T) => T | void }>();

  listener() {
    return new StoppableHookableEvent(
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
      if (result === undefined) {
        // Do nothing
      } else if (result === null) {
        return null;
      } else {
        new_event = result;
      }
    }
    return new_event;
  }
}
