import { type AnySignal } from "../utils/signals.ts";

export type Driver_v1<InputSignal, Output = void> = (inputs: {
  signal: AbortSignal;
  effect: (fn: () => void) => void;
  input$: AnySignal<Array<InputSignal>>;
}) => Output;
