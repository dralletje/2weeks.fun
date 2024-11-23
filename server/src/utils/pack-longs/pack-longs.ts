import { bitarray_thing } from "./bit-array-fast.ts";

export let pack_bits_in_longs = (
  entries: Array<number>,
  bits_per_entry: number
): Uint8Array => {
  return bitarray_thing(entries, bits_per_entry);
};
