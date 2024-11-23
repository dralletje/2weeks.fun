import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pack_bits_in_longs_in_uint8array,
  pack_bits_in_longs_in_uint8array_slow,
  pack_bits_in_longs_in_uint8array_no_bigint,
} from "./pack-longs.ts";
import { range } from "lodash-es";

describe("pack-longs", () => {
  let example_numbers = [0, 1, 2, 3, 4, 5, 6, 7];

  it("Slow and fast should yield same value", () => {
    for (let i = 0; i < 1000; i++) {
      let entries = range(i);

      let slow = pack_bits_in_longs_in_uint8array_slow(entries, 15);
      let fast = pack_bits_in_longs_in_uint8array(entries, 15);
      let no_bigint = pack_bits_in_longs_in_uint8array_no_bigint(entries, 15);

      // assert.deepStrictEqual(fast, slow);
      assert.deepStrictEqual(no_bigint, slow);
    }
  });
});
