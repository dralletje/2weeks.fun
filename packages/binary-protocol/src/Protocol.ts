export type ProtocolResult<T> = [T, number];
export type Protocol<T> = (buffer: Uint8Array) => ProtocolResult<T>;

type ResultOfProtocol<T> = T extends Protocol<infer U> ? U : never;

/// https://stackoverflow.com/questions/53925857/typescript-typedarray-interface-for-typed-arrays
type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

type ResultsOfProtocols<Tuple extends readonly Protocol<any>[]> = {
  [Index in keyof Tuple]: ResultOfProtocol<Tuple[Index]>;
} & { length: Tuple["length"] };

export let decode_combined =
  <T extends readonly [] | readonly Protocol<any>[]>(
    protocol: T
  ): Protocol<ResultsOfProtocols<T>> =>
  (buffer: Uint8Array): ProtocolResult<ResultsOfProtocols<T>> => {
    let offset = 0;

    /// Typescript can't help us here
    let results: any = [];

    for (let proc of protocol) {
      let [value, length] = proc(buffer.slice(offset));
      results.push(value);
      offset = offset + length;
    }
    return [results, offset];
  };

export const consume =
  <T>(protocol: Protocol<T>) =>
  (buffer: Uint8Array): T => {
    let [value, bytes_parsed] = protocol(buffer);
    if (bytes_parsed < buffer.length) {
      throw new Error(`Spare bytes: ${buffer.length - bytes_parsed}`);
    }
    return value;
  };

export const encode_combined = (arrays: Array<TypedArray>) => {
  let length = 0;
  for (let array of arrays) {
    length = length + array.byteLength;
  }

  let result = new Uint8Array(length);
  let i = 0;
  for (let array of arrays) {
    result.set(
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
      i
    );
    i = i + array.byteLength;
  }
  return result;
};

export let decode_identity: Protocol<Uint8Array> = (
  buffer: Uint8Array
): ProtocolResult<Uint8Array> => {
  return [buffer, buffer.length];
};
