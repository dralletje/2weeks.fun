export let bitarray_thing = (
  entries: Array<number>,
  bits_per_entry: number
): Uint8Array => {
  let entries_per_long = Math.floor(64 / bits_per_entry);

  let valuesPerLong = Math.floor(64 / bits_per_entry);
  let bufferSize = Math.ceil(entries.length / valuesPerLong) * 2;
  let valueMask = (1 << bits_per_entry) - 1;
  let buffer = new Uint32Array(bufferSize);

  for (let index = 0; index < entries.length; index++) {
    let value = entries[index];
    // bitarray.set(i, entries[i]);

    // assert(index >= 0 && index < this.capacity, 'index is out of bounds')
    // assert(value <= this.valueMask, 'value does not fit into bits per value')

    let startLongIndex = Math.floor(index / valuesPerLong);
    let indexInLong = (index - startLongIndex * valuesPerLong) * bits_per_entry;
    if (indexInLong >= 32) {
      let indexInStartLong = indexInLong - 32;
      buffer[startLongIndex * 2 + 1] =
        ((buffer[startLongIndex * 2 + 1] & ~(valueMask << indexInStartLong)) |
          ((value & valueMask) << indexInStartLong)) >>>
        0;
      continue;
    }
    let indexInStartLong = indexInLong;

    // Clear bits of this value first
    buffer[startLongIndex * 2] =
      ((buffer[startLongIndex * 2] & ~(valueMask << indexInStartLong)) |
        ((value & valueMask) << indexInStartLong)) >>>
      0;
    let endBitOffset = indexInStartLong + bits_per_entry;
    if (endBitOffset > 32) {
      // Value stretches across multiple longs
      buffer[startLongIndex * 2 + 1] =
        ((buffer[startLongIndex * 2 + 1] & ~((1 << (endBitOffset - 32)) - 1)) |
          (value >> (32 - indexInStartLong))) >>>
        0;
    }
  }

  return to_buffer(buffer);
};

let set = (index, value) => {};

let to_buffer = (input) => {
  let buffer = new DataView(new ArrayBuffer(input.length * 4));
  for (let i = 0; i < input.length; i += 2) {
    // smartBuffer.writeUInt32BE(input[i + 1]);
    // smartBuffer.writeUInt32BE(input[i]);

    buffer.setUint32(i * 4, input[i + 1]);
    buffer.setUint32(i * 4 + 4, input[i]);
  }
  return new Uint8Array(buffer.buffer);
};
