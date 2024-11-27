import { Signal } from "signal-polyfill";
import { type AnySignal } from "./signals.ts";

export let combine_map_signals = <Key, Value>(
  signals: Array<AnySignal<Map<Key, Value>> | null | undefined>
) => {
  return new Signal.Computed(() => {
    return new Map(
      signals.flatMap((signal) => {
        if (signal) {
          return Array.from(signal.get());
        } else {
          return [];
        }
      })
    );
  });
};

export let combine_array_signals = <Value>(
  signals: Array<AnySignal<Array<Value>> | null | undefined>
) => {
  return new Signal.Computed(() => {
    return signals.flatMap((signal) => {
      if (signal) {
        return signal.get();
      } else {
        return [];
      }
    });
  });
};

export let combine_single_signals = <Value>(
  signals: Array<AnySignal<Value> | null | undefined>
) => {
  let non_null_signals = signals.filter((signal) => signal != null);
  if (non_null_signals.length > 1) {
    throw new Error("Expected only one non-null signal");
  }
  return non_null_signals[0] as AnySignal<Value> | null;
};
