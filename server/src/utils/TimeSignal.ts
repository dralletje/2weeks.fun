import { Signal } from "signal-polyfill";
import { type AnySignal } from "./signals.ts";

export class TimeSignal implements AnySignal<number> {
  #state = new Signal.State(0);
  #start_time = new Date();

  constructor(interval: number, { signal }: { signal: AbortSignal }) {
    let interval_instance = setInterval(() => {
      this.#state.set(this.#state.get() + 1);
    }, interval);
    signal.addEventListener("abort", () => {
      clearInterval(interval_instance);
    });
  }

  get() {
    this.#state.get();

    return Date.now() - this.#start_time.getTime();
  }
}

export class TickSignal implements AnySignal<number> {
  #state = new Signal.State(0);

  constructor(interval: number, { signal }: { signal: AbortSignal }) {
    let interval_instance = setInterval(() => {
      this.#state.set(this.#state.get() + 1);
    }, interval);
    signal.addEventListener("abort", () => {
      clearInterval(interval_instance);
    });
  }

  get() {
    return this.#state.get();
  }
}
