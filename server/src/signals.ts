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

// export type AnySignal<T> = Signal.State<T> | Signal.Computed<T>;
export interface AnySignal<T> {
  get(): T;
}
