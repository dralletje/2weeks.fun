import { Signal } from "signal-polyfill";

export class SignalPool {
  needs_enqueue = true;
  dirty = false;

  watcher: Signal.subtle.Watcher;

  constructor() {
    let processPending = () => {
      this.needs_enqueue = true;

      for (const s of this.watcher.getPending()) {
        s.get();
      }

      this.watcher.watch();
    };

    this.watcher = new Signal.subtle.Watcher(() => {
      if (this.needs_enqueue) {
        // queueMicrotask(processPending);
        this.needs_enqueue = false;

        // setImmediate(() => {
        //   processPending();
        // });
        setTimeout(() => {
          processPending();
        }, 0);
      }
    });
  }

  effectWithSignal = (
    signal: AbortSignal,
    callback: () => Promise<void> | void | (() => void)
  ) => {
    let cleanup;

    const computed = new Signal.Computed(() => {
      typeof cleanup === "function" && cleanup();
      cleanup = callback();
    });

    this.watcher.watch(computed);
    computed.get();

    let fn = () => {
      this.watcher.unwatch(computed);
      typeof cleanup === "function" && cleanup();
      cleanup = undefined;
    };

    signal.addEventListener("abort", fn);
  };
}
