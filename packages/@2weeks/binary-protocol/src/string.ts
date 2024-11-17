import { type ProtocolResult } from "./Protocol.ts";
import {
  decode_with_varint_length,
  encode_with_varint_length,
} from "./with_varint_length.ts";

export let encode_string = (value: string): Uint8Array => {
  return encode_with_varint_length(new TextEncoder().encode(value));
};

export let decode_string = decode_with_varint_length((buffer) => [
  new TextDecoder().decode(buffer),
  buffer.length,
]);

export let encode_json = (value: any): Uint8Array => {
  return encode_string(JSON.stringify(value));
};

export let decode_json = <T extends unknown>(
  buffer: Uint8Array
): ProtocolResult<T> => {
  let [value, length] = decode_string(buffer);
  try {
    return [JSON.parse(value), length];
  } catch (error) {
    console.log(`value:`, value);
    throw new Error(`Failed to parse JSON: ${error}`);
  }
};
