import { type ProtocolResult } from "./Protocol.ts";

//////////////////////
/// Unsigned integers
//////////////////////

export let decode_uint8 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [buffer[0], 1];
};
export let encode_uint8 = (value: number): Uint8Array => {
  return new Uint8Array([value]);
};

let to_dataview = (buffer: Uint8Array): DataView => {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};

export let decode_uint16 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [to_dataview(buffer).getUint16(0), 2];
};
export let encode_uint16 = (value: number): Uint8Array => {
  let buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, value);
  return new Uint8Array(buffer);
};

export let encode_int32 = (value: number): Uint8Array => {
  let buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, value);
  return new Uint8Array(buffer);
};
export let decode_int32 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [to_dataview(buffer).getInt32(0), 4];
};

//////////////////////
/// Signed integers
//////////////////////

export let decode_int8 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [new Int8Array(buffer.buffer)[0], 1];
};
export let encode_int8 = (value: number): Uint8Array => {
  return new Uint8Array([value]);
};

export let decode_int16 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [to_dataview(buffer).getInt16(0), 2];
};
export let encode_int16 = (value: number): Uint8Array => {
  let buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, value);
  return new Uint8Array(buffer);
};

export let decode_uint64 = (buffer: Uint8Array): ProtocolResult<bigint> => {
  return [to_dataview(buffer).getBigUint64(0), 8];
};
export let encode_uint64 = (value: bigint): Uint8Array => {
  let buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, value);
  return new Uint8Array(buffer);
};

export let decode_int64 = (buffer: Uint8Array): ProtocolResult<bigint> => {
  return [to_dataview(buffer).getBigInt64(0), 8];
};
export let encode_int64 = (value: bigint): Uint8Array => {
  let buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, value);
  return new Uint8Array(buffer);
};

export let encode_uint128 = (value: bigint): Uint8Array => {
  let buffer = new ArrayBuffer(16);

  let view = new DataView(buffer);
  view.setBigInt64(8, BigInt.asUintN(64, value >> 64n));
  view.setBigInt64(0, BigInt.asUintN(64, value));

  return new Uint8Array(buffer);
};

export let decode_uint128 = (buffer: Uint8Array): ProtocolResult<bigint> => {
  let view = to_dataview(buffer);
  let big = view.getBigUint64(0) << 64n;
  let little = view.getBigUint64(8);
  return [big + little, 16];
};

//////////////////////
/// Floating point
//////////////////////

export let decode_float32 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [to_dataview(buffer).getFloat32(0), 4];
};
export let encode_float32 = (value: number): Uint8Array => {
  let buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value);
  return new Uint8Array(buffer);
};

export let decode_float64 = (buffer: Uint8Array): ProtocolResult<number> => {
  return [to_dataview(buffer).getFloat64(0), 8];
};
export let encode_float64 = (value: number): Uint8Array => {
  let buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value);
  return new Uint8Array(buffer);
};
