import { type Protocol, encode_combined } from "./Protocol.ts";
import { decode_varint, encode_varint } from "./varint.ts";

export let encode_with_varint_length = (value: Uint8Array): Uint8Array => {
  let length_bits = encode_varint(value.length);
  return encode_combined([length_bits, value]);
};

export let decode_with_varint_length =
  <T>(protocol: Protocol<T>) =>
  (buffer: Uint8Array): [T, number] => {
    let [value, length] = decode_varint(buffer);

    if (buffer.length < length + value) {
      throw new Error(`Not enough bytes: ${buffer.length} < ${length + value}`);
    }

    let [result, parsed_length] = protocol(
      buffer.subarray(length, length + value)
    );

    // if (parsed_length !== value) {
    //   throw new Error(`Length mismatch: ${parsed_length} != ${value}`);
    // }

    return [result, length + value];
  };
