import { chunk, range } from "lodash-es";

export let pack_bits_in_longs = (
  entry: Array<number>,
  bits_per_entry: number
) => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let chunks = chunk(entry, entries_per_long);

  let longs = chunks.map((chunk) => {
    let long = 0n;
    /// Not reeeaaallly sure why this is reversed...
    /// BUT IT WORKS!
    for (let bit of chunk.toReversed()) {
      long = (long << BigInt(bits_per_entry)) | BigInt(bit);
    }
    return long;
  });
  return longs;
};

export let unpack_bits_from_longs = (
  longs: Array<bigint>,
  bits_per_entry: number
) => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let entries = longs.flatMap((long) => {
    let entry: Array<number> = [];
    for (let i of range(0, entries_per_long)) {
      entry.push(Number(long & ((1n << BigInt(bits_per_entry)) - 1n)));
      long >>= BigInt(bits_per_entry);
    }
    return entry;
  });
  return entries;
};
