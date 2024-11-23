import { chunk, range } from "lodash-es";
import { bitarray_thing } from "./bit-array-fast.ts";

/**
 * Slow version! Just as a reference
 */
export let pack_bits_in_longs = (
  entries: Array<number>,
  bits_per_entry: number
) => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let chunks = chunk(entries, entries_per_long);

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

export let pack_bits_in_longs_in_uint8array_slow = (
  entries: Array<number>,
  bits_per_entry: number
): Uint8Array => {
  let longs = pack_bits_in_longs(entries, bits_per_entry);

  let buffer = new ArrayBuffer(longs.length * 8);
  let dataview = new DataView(buffer);
  for (let i = 0; i < longs.length; i++) {
    dataview.setBigInt64(i * 8, longs[i]);
  }
  return new Uint8Array(buffer);

  // return new Uint8Array(new BigInt64Array(longs).buffer);
  // ]);
  // return LongArray.encode(pack_bits_in_longs(entries, bits_per_entry));
};

export let pack_bits_in_longs_in_uint8array = (
  entries: Array<number>,
  bits_per_entry: number
): Uint8Array => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let long_count = Math.ceil(entries.length / entries_per_long);

  let buffer = new ArrayBuffer(long_count * 8);
  let dataview = new DataView(buffer);

  for (let long_index = 0; long_index < long_count; long_index++) {
    let long = 0n;
    for (let i = 0; i < entries_per_long; i++) {
      let value = entries[(long_index + 1) * entries_per_long - 1 - i];
      long = (long << BigInt(bits_per_entry)) | BigInt(value ?? 0);
    }
    dataview.setBigInt64(long_index * 8, long);
  }
  return new Uint8Array(buffer);
};

export let pack_bits_in_longs_in_uint8array_no_bigint = (
  entries: Array<number>,
  bits_per_entry: number
): Uint8Array => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let long_count = Math.ceil(entries.length / entries_per_long);

  // let buffer = new Uint32Array(long_count * 2);
  // let valueMask = (1 << bits_per_entry) - 1;

  // let bitarray = new BitArray({
  //   capacity: entries.length,
  //   bitsPerValue: bits_per_entry,
  // });

  // for (let i = 0; i < entries.length; i++) {
  //   bitarray.set(i, entries[i]);
  // }

  // return bitarray.buffer();

  return bitarray_thing(entries, bits_per_entry);

  // for (let long_index = 0; long_index < long_count; long_index++) {
  //   // let long = 0n;
  //   let current_bit = 0;
  //   for (let i = 0; i < entries_per_long; i++) {
  //     let index = long_index * entries_per_long + i;
  //     let value = entries[index];

  //     const startLongIndex = Math.floor(index / entries_per_long);
  //     const indexInLong =
  //       (index - startLongIndex * entries_per_long) * bits_per_entry;
  //     if (indexInLong >= 32) {
  //       const indexInStartLong = indexInLong - 32;
  //       buffer[startLongIndex * 2 + 1] =
  //         ((buffer[startLongIndex * 2 + 1] & ~(valueMask << indexInStartLong)) |
  //           ((value & valueMask) << indexInStartLong)) >>>
  //         0;
  //       continue;
  //     }
  //     const indexInStartLong = indexInLong;

  //     // Clear bits of this value first
  //     buffer[startLongIndex * 2] =
  //       ((buffer[startLongIndex * 2] & ~(valueMask << indexInStartLong)) |
  //         ((value & valueMask) << indexInStartLong)) >>>
  //       0;
  //     const endBitOffset = indexInStartLong + bits_per_entry;
  //     if (endBitOffset > 32) {
  //       // Value stretches across multiple longs
  //       buffer[startLongIndex * 2 + 1] =
  //         ((buffer[startLongIndex * 2 + 1] &
  //           ~((1 << (endBitOffset - 32)) - 1)) |
  //           (value >> (32 - indexInStartLong))) >>>
  //         0;
  //     }
  //   }
  // }
  // return new Uint8Array(buffer.buffer);
};

/**
 * Pack numbers into a Uint8Array using the given number of bits per entry.
 * The entries are packed into 64-bit longs, padded with zeros if necessary.
 */
// export let pack_bits_in_longs_in_uint8array = (
//   entries: Array<number>,
//   bits_per_entry: number
// ) => {
//   let entries_per_long = Math.floor(64 / bits_per_entry);
//   let long_count = Math.ceil(entries.length / entries_per_long);

//   let buffer = new ArrayBuffer(long_count * 8);
//   let dataview = new DataView(buffer);

//   for (let i = 0; i < long_count; i++) {
//     let long_to_write = 0n;
//     for (let j = 0; j < entries_per_long; j++) {
//       let entry = entries[i * entries_per_long + j] || 0;
//       long_to_write = (long_to_write << BigInt(bits_per_entry)) | BigInt(entry);
//     }
//     dataview.setBigInt64(i * 8, long_to_write);
//   }

//   return new Uint8Array(buffer);
// };

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
