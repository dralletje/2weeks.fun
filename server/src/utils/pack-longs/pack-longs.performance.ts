import { meanBy, range } from "lodash-es";
import {
  pack_bits_in_longs_in_uint8array,
  pack_bits_in_longs_in_uint8array_no_bigint,
  pack_bits_in_longs_in_uint8array_slow,
} from "./pack-longs-experiments.ts";
// import {
//   pack_bits_in_longs_in_uint8array,
//   pack_bits_in_longs_in_uint8array_slow,
//   pack_bits_in_longs_in_uint8array_no_bigint,
// } from "./pack-longs.ts";

let benchmark = (fn: (measure: (run: () => void) => void) => void) => {
  let results: Array<{ time: number }> = [];

  let TOTAL_TIME_TO_SPEND = 1000;
  let start = Date.now();

  while (Date.now() - start < TOTAL_TIME_TO_SPEND) {
    fn((run) => {
      let start = Date.now();
      run();
      let end = Date.now();
      results.push({ time: end - start });
    });
  }

  return meanBy(results, (x) => x.time);
};

let fast = benchmark((measure) => {
  for (let i = 0; i < 5000; i++) {
    let entries = range(i);
    measure(() => {
      pack_bits_in_longs_in_uint8array(entries, 15);
    });
  }
});

let slow = benchmark((measure) => {
  for (let i = 1; i < 5000; i++) {
    let entries = range(i);
    measure(() => {
      pack_bits_in_longs_in_uint8array_slow(entries, 15);
    });
  }
});

let without_bigint = benchmark((measure) => {
  for (let i = 0; i < 5000; i++) {
    let entries = range(i);
    measure(() => {
      pack_bits_in_longs_in_uint8array_no_bigint(entries, 15);
    });
  }
});

console.log(`fast:`, fast);
console.log(`slow:`, slow);
console.log(`without_bigint:`, without_bigint);
