import {
  encode_int16,
  encode_int32,
  encode_int64,
  encode_int8,
  encode_uint8,
} from "@2weeks/binary-protocol/bytes";
import { encode_combined } from "@2weeks/binary-protocol/Protocol";

let encode_nbt_internal_string = (value: string) => {
  return encode_combined([
    encode_int16(value.length),
    new TextEncoder().encode(value),
  ]);
};

export let encode_nbt_root = (entries: Array<Uint8Array>) => {
  return encode_combined([encode_uint8(0x0a), ...entries, encode_uint8(0x00)]);
};

export let encode_nbt_compound = (name: string, entries: Array<Uint8Array>) => {
  return encode_combined([
    encode_uint8(0x0a),
    encode_nbt_internal_string(name),
    ...entries,
    encode_uint8(0x00),
  ]);
};

export let encode_nbt_string = (name: string | null, value: string) => {
  /// TODO Has to be "modified UTF-8" but we're not going to bother with that for now
  return encode_combined([
    encode_uint8(0x08),
    name == null ? new Uint8Array() : encode_nbt_internal_string(name),
    encode_nbt_internal_string(value),
  ]);
};

export let encode_nbt_byte = (name: string, value: number) => {
  return encode_combined([
    encode_uint8(0x01),
    encode_nbt_internal_string(name),
    encode_int8(value),
  ]);
};

export let encode_nbt_short = (name: string, value: number) => {
  return encode_combined([
    encode_uint8(0x02),
    encode_nbt_internal_string(name),
    encode_int16(value),
  ]);
};

export let encode_nbt_int = (name: string, value: number) => {
  return encode_combined([
    encode_uint8(0x03),
    encode_nbt_internal_string(name),
    encode_int32(value),
  ]);
};

export let encode_nbt_long = (name: string, value: bigint) => {
  return encode_combined([
    encode_uint8(0x04),
    encode_nbt_internal_string(name),
    encode_int64(value),
  ]);
};
