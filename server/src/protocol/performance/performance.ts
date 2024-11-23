import { meanBy } from "lodash-es";
import varint from "varint";

let benchmark = (fn) => {
  let results: Array<{ time: number }> = [];

  let TOTAL_TIME_TO_SPEND = 1000;
  let start = Date.now();

  while (Date.now() - start < TOTAL_TIME_TO_SPEND) {
    let start = Date.now();
    fn();
    let end = Date.now();
    results.push({ time: end - start });
  }

  return meanBy(results, (x) => x.time);
};

export let encode_varint_from_npm = (value: number): Uint8Array => {
  if (value === 0) {
    return new Uint8Array([0]);
  }
  if (value < 127) {
    return new Uint8Array([value]);
  }

  return new Uint8Array(varint.encode(value));
};

export let encode_varint_maybe_faster = (value: number): Uint8Array => {
  if (value === 0) {
    return new Uint8Array([0]);
  }
  if (value < 127) {
    return new Uint8Array([value]);
  }

  return new Uint8Array(varint.encode(value));
};

export let encode_varint_to_buffer = (
  value: number,
  buffer: Uint8Array
): Uint8Array => {
  if (value < 127) {
    buffer[0] = value;
  }

  // return new Uint8Array(varint.encode(value));
  varint.encode(value, buffer);
};

let npm = benchmark(() => {
  for (let i = 0; i < 200; i++) {
    encode_varint_from_npm(i);
  }
});

let faster = benchmark(() => {
  for (let i = 0; i < 200; i++) {
    encode_varint_maybe_faster(i);
  }
});

let to_buffer = benchmark(() => {
  let buffer = new Uint8Array(300);
  for (let i = 0; i < 200; i++) {
    encode_varint_to_buffer(i, buffer.subarray(i));
  }
});

console.log(`npm:`, npm);
console.log(`faster:`, faster);
console.log(`to_buffer:`, to_buffer);
