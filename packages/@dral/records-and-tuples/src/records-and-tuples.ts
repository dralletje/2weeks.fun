import {
  Record as BloombergRecord,
  Tuple as BloombergTuple,
} from "@bloomberg/record-tuple-polyfill";

declare const mark: unique symbol;
export type Record<T = unknown> = T & { readonly [mark]: "Record" };
export type Tuple<T = unknown> = T & { readonly [mark]: "Tuple" };

export let Record = BloombergRecord as <T>(obj: T) => Record<T>;
export let Tuple = BloombergTuple as <T extends unknown[]>(
  ...args: T
) => Tuple<T>;
