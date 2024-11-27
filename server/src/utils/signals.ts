import { Signal } from "signal-polyfill";

let needsEnqueue = true;
// let did_change_while_waiting = false

const w = new Signal.subtle.Watcher(() => {
  if (needsEnqueue) {
    // queueMicrotask(processPending);
    needsEnqueue = false;

    setImmediate(() => {
      processPending();
    });
  }
});

function processPending() {
  needsEnqueue = true;

  for (const s of w.getPending()) {
    s.get();
  }

  w.watch();
}

export function effect(callback: () => Promise<void> | void | (() => void)) {
  let cleanup;

  const computed = new Signal.Computed(() => {
    try {
      typeof cleanup === "function" && cleanup();
      cleanup = callback();
    } catch (error) {
      console.error(error);
    }
  });

  w.watch(computed);
  computed.get();

  return () => {
    w.unwatch(computed);
    typeof cleanup === "function" && cleanup();
    cleanup = undefined;
  };
}

export function effectWithSignal(
  signal: AbortSignal,
  callback: () => Promise<void> | void | (() => void)
) {
  let cleanup;

  const computed = new Signal.Computed(() => {
    typeof cleanup === "function" && cleanup();
    cleanup = callback();
  });

  w.watch(computed);
  computed.get();

  let fn = () => {
    w.unwatch(computed);
    typeof cleanup === "function" && cleanup();
    cleanup = undefined;
  };

  signal.addEventListener("abort", fn);
}

export let ConstantSignal = <T>(value: T): AnySignal<T> => {
  return {
    get: () => value,
  };
};

export let async_computed = <T>(
  callback: (signal: AbortSignal) => Promise<T>
): AnySignal<{ loading: true } | { loading: false; value: T }> => {
  let state = new Signal.State<
    | { loading: true; previous_value: T | null }
    | { loading: false; get: () => T }
  >({ loading: true, previous_value: null });
  let current_abortcontroller = new AbortController();

  let promise_starter = new Signal.Computed<void>(() => {
    current_abortcontroller.abort();
    let local_abortcontroller = new AbortController();
    current_abortcontroller = local_abortcontroller;

    let current_state = Signal.subtle.untrack(() => state.get());
    try {
      state.set({
        loading: true,
        previous_value:
          current_state.loading ?
            current_state.previous_value
          : current_state.get(),
      });
    } catch {
      state.set({ loading: true, previous_value: null });
    }

    try {
      callback(current_abortcontroller.signal)
        .then(async (result) => {
          if (local_abortcontroller.signal.aborted) return;

          state.set({ loading: false, get: () => result });
        })
        .catch((error) => {
          if (local_abortcontroller.signal.aborted) return;
          state.set({
            loading: false,
            get: () => {
              throw error;
            },
          });
        });
    } catch (error) {
      throw error;
    }
  });

  return {
    get: () => {
      promise_starter.get();
      let value = state.get();

      if (value.loading) {
        return { loading: true };
      } else {
        return { loading: false, value: value.get() };
      }
    },
  };
};

export class NotificationSignal implements AnySignal<void> {
  #signal = new Signal.State({});

  notify() {
    this.#signal.set({});
  }

  get() {
    this.#signal.get();
    return undefined;
  }
}

// export type AnySignal<T> = Signal.State<T> | Signal.Computed<T>;
export interface AnySignal<T> {
  get(): T;
}
