import { type AnySignal } from "../signals.ts";

export type Driver_v1<T> = (inputs: {
  signal: AbortSignal;
  effect: (fn: () => void) => void;
  input$: AnySignal<Array<T>>;
}) => any;
