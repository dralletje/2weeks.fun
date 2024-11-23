export type HookableEventHandler<T> = (value: T) => void | T | null;

export class StoppableHookableEvent<T> {
  #on: (
    event: HookableEventHandler<T>,
    options: { signal: AbortSignal }
  ) => void;
  #end: (
    event: HookableEventHandler<T>,
    options: { signal: AbortSignal }
  ) => void;
  constructor(
    on: (
      event: HookableEventHandler<T>,
      options: { signal: AbortSignal }
    ) => void,
    end: (
      event: HookableEventHandler<T>,
      options: { signal: AbortSignal }
    ) => void
  ) {
    this.#on = on;
    this.#end = end;
  }
  on(event: HookableEventHandler<T>, options: { signal: AbortSignal }) {
    return this.#on(event, options);
  }

  end(event: HookableEventHandler<T>, options: { signal: AbortSignal }) {
    return this.#end(event, options);
  }
}

export class StoppableHookableEventController<T> {
  #listeners = new Map<any, { run: HookableEventHandler<T> }>();
  #last: HookableEventHandler<T> | null = null;

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
      },
      (listener: (value: T) => void, options: { signal: AbortSignal }) => {
        if (this.#last != null) {
          throw new Error("Already have an end listener");
        }
        this.#last = listener;
        if (options?.signal) {
          options.signal.addEventListener("abort", () => {
            this.#last = null;
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

    if (this.#last != null) {
      let result = this.#last(new_event);
      return null;
    }

    return new_event;
  }
}
