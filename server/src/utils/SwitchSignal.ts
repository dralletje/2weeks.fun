import { Signal } from "signal-polyfill";
import { type AnySignal } from "../signals.ts";

export class SwitchSignalController<T> {
  #signalsignal: Signal.State<AnySignal<T>>;
  constructor(signal: AnySignal<T>) {
    this.#signalsignal = new Signal.State(signal);
  }

  signal() {
    return new Signal.Computed(() => {
      return this.#signalsignal.get().get();
    });
  }
  set_signal(value: AnySignal<T>) {
    this.#signalsignal.set(value);
  }
}
