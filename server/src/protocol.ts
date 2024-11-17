import {
  decode_uint128,
  decode_int64,
  decode_uint16,
  encode_int64,
  encode_uint128,
  encode_uint8,
  decode_uint8,
  decode_int8,
  encode_int32,
  encode_int8,
  encode_float64,
  encode_float32,
  decode_float64,
  encode_int16,
  decode_int32,
  encode_uint16,
  decode_int16,
  decode_uint64,
  encode_uint64,
  decode_float32,
} from "@2weeks/binary-protocol/bytes";
import { range, sumBy } from "lodash-es";

class DecodeError extends Error {
  cause: Error;
  operator: string;
  constructor({ operator, cause }: { operator: string; cause: Error }) {
    super();

    this.operator = operator;
    this.cause = cause;
  }

  get stack() {
    return this.cause.stack;
  }

  get message() {
    return `Error decoding ${this.operator}: ${this.cause.message}`;
  }
}

type TypeAndValue<Type, Value> = Value extends undefined
  ? { type: Type }
  : { type: Type; value: Value };

export let switch_on_type = <
  const Prefix extends string,
  const Protocols extends { [key in Prefix]: Protocol<any> },
>(
  type_from_prefix: Protocol<keyof Protocols>,
  items: Protocols
): Protocol<
  {
    [Prefix in keyof Protocols]: TypeAndValue<
      Prefix,
      ValueOfProtocol<Protocols[Prefix]>
    >;
    //   type: Prefix;
    //   value: ValueOfProtocol<Protocols[Prefix]>;
    // };
  }[keyof Protocols]
> => {
  return {
    encode: (value) => {
      let protocol = items[value.type];
      if (!protocol) {
        // @ts-ignore
        throw new Error(`No protocol matched prefix ${value.type}`);
      }
      return concat([
        type_from_prefix.encode(value.type),
        protocol.encode("value" in value ? value.value : undefined),
      ]);
    },
    decode: (buffer) => {
      let [type, offset] = type_from_prefix.decode(buffer);

      let protocol = items[type];
      if (!protocol) {
        // @ts-ignore
        throw new Error(`No protocol matched prefix ${type}`);
      }

      try {
        let [result, length] = protocol.decode(buffer.subarray(offset));
        return [
          result === undefined ? { type } : { type, value: result },
          offset + length,
        ] as any;
      } catch (e) {
        console.error("switch_on_type, Error decoding", {
          type,
          buffer: buffer.subarray(offset),
        });
        throw e;
      }
    },
  };
};

export let concat = (buffers: Array<Uint8Array>) => {
  let length = sumBy(buffers, (buffer) => buffer.length);
  let result = new Uint8Array(length);
  let offset = 0;
  for (let buffer of buffers) {
    result.set(buffer, offset);
    offset = offset + buffer.length;
  }
  return result;
};

export type Protocol<T> = {
  encode: (value: T) => Uint8Array;
  decode: (buffer: Uint8Array) => [T, number];
};
export type ValueOfProtocol<T> = T extends Protocol<infer U> ? U : never;

export let native = {
  string: {
    encode: (value: string) => new TextEncoder().encode(value),
    decode: (buffer: Uint8Array) => [
      new TextDecoder().decode(buffer),
      buffer.length,
    ],
  } satisfies Protocol<string>,
  uint8array: {
    encode: (value: Uint8Array) => value,
    decode: (buffer: Uint8Array) => [buffer, buffer.length],
  } as Protocol<Uint8Array>,
  limited_size: <P extends Protocol<any>>(length: number, protocol: P) => {
    return {
      encode: (value: ValueOfProtocol<P>) => {
        let buffer = protocol.encode(value);
        if (buffer.length > length) {
          // prettier-ignore
          throw new Error(`Expected buffer of length ${length}, got ${buffer.length}`);
        }
        return buffer;
      },
      decode: (buffer: Uint8Array) => {
        if (buffer.length > length) {
          // prettier-ignore
          throw new Error(`Expected buffer of length ${length}, got ${buffer.length}`);
        }
        return protocol.decode(buffer);
      },
    };
  },
  bytes: (length: number) =>
    ({
      encode: (value: Uint8Array) => {
        if (value.length !== length) {
          throw new Error(`Expected ${length} bytes, got ${value.length}`);
        }
        return value;
      },
      decode: (buffer: Uint8Array) => {
        return [buffer.subarray(0, length), length];
      },
    }) satisfies Protocol<Uint8Array>,
  empty: {
    encode: () => new Uint8Array([]),
    decode: (buffer: Uint8Array) => [undefined, 0],
  } as Protocol<void>,

  irrelevant: (bytes: number) =>
    ({
      encode: () => new Uint8Array(bytes),
      decode: (buffer: Uint8Array) => [undefined, bytes],
    }) satisfies Protocol<void>,

  with_byte_length: <T>(
    length_protocol: Protocol<number>,
    payload_protocol: Protocol<T>
  ): Protocol<T> => {
    let stack = new Error().stack;

    return {
      encode: (value) => {
        let payload = payload_protocol.encode(value);
        let length_bits = length_protocol.encode(payload.length);
        return concat([length_bits, payload]);

        // return encode_with_varint_length(protocol.encode(value));
      },
      decode: (buffer) => {
        try {
          let [length, offset] = length_protocol.decode(buffer);
          let [value, value_offset] = payload_protocol.decode(
            buffer.slice(offset, offset + length)
          );

          if (length !== value_offset) {
            console.log(`length_protocol.decode:`, length_protocol.decode);
            console.log(`buffer:`, buffer.subarray(0, offset));
            console.log(`length:`, length);
            // prettier-ignore
            throw new Error(`Decoded too little (expected ${length}, but only decoded ${value_offset})`);
          }

          return [value, offset + length];
        } catch (e) {
          // e.stack = stack;
          throw e;
        }
      },
    };
  },

  repeated: <T>(
    times_protocol: Protocol<number>,
    protocol: Protocol<T>
  ): Protocol<Array<T>> => {
    return {
      encode: (value) => {
        return concat([
          times_protocol.encode(value.length),
          ...value.map((item) => protocol.encode(item)),
        ]);
      },
      decode: (buffer) => {
        let [count, count_length] = times_protocol.decode(buffer);
        let offset = count_length;
        let items: Array<T> = [];

        for (let i of range(count)) {
          try {
            let [item, length] = protocol.decode(buffer.slice(offset));
            items.push(item);
            offset = offset + length;
          } catch (error) {
            console.error("repeated, Error decoding", {
              count,
              i,
              buffer,
              items_buffer: buffer.subarray(count_length),
              next: buffer.subarray(offset),
            });
            throw error;
          }
        }
        return [items, offset];
      },
    };
  },

  enum: <const T>(
    protocol: Protocol<number>,
    values: Array<T>
  ): Protocol<T> => {
    return {
      encode: (value: T) => {
        let index = values.indexOf(value);
        if (index === -1) {
          throw new Error(`Invalid enum value: ${value}`);
        }
        return protocol.encode(index);
      },
      decode: (buffer: Uint8Array) => {
        let [value, offset] = protocol.decode(buffer);
        if (value < 0 || value >= values.length) {
          throw new Error(`Invalid enum value: ${value}`);
        }
        return [values[value], offset];
      },
    };
  },
};

export let prefilled = <T>(protocol: Protocol<T>, value: T): Protocol<void> => {
  return {
    encode: () => protocol.encode(value),
    decode: (buffer) => {
      let [decoded, offset] = protocol.decode(buffer);
      if (decoded !== value) {
        throw new Error(`Expected ${value}, got ${decoded}`);
      }
      return [undefined, offset];
    },
  };
};

export let bytes = {
  uint8: {
    encode: encode_uint8,
    decode: decode_uint8,
  } satisfies Protocol<number>,
  int8: {
    encode: encode_int8,
    decode: decode_int8,
  } satisfies Protocol<number>,
  uint16: {
    encode: encode_uint16,
    decode: decode_uint16,
  } satisfies Protocol<number>,
  int16: {
    encode: encode_int16,
    decode: decode_int16,
  } satisfies Protocol<number>,
  /// Missing: uint32
  int32: {
    encode: encode_int32,
    decode: decode_int32,
  } satisfies Protocol<number>,
  uint64: {
    encode: encode_uint64,
    decode: decode_uint64,
  } satisfies Protocol<bigint>,
  int64: {
    encode: encode_int64,
    decode: decode_int64,
  } satisfies Protocol<bigint>,
  uint128: {
    encode: encode_uint128,
    decode: decode_uint128,
  } satisfies Protocol<bigint>,
  /// Missing: int128

  float32: {
    encode: encode_float32,
    decode: decode_float32,
  } satisfies Protocol<number>,
  float64: {
    encode: encode_float64,
    decode: decode_float64,
  } satisfies Protocol<number>,
};

/// Adapted from https://dev.to/svehla/typescript-object-fromentries-389c
type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;
type FromEntries<T> = T extends { name?: infer Key; protocol: Protocol<any> }[]
  ? {
      [K in Extract<Key, string>]: ValueOfProtocol<
        Extract<ArrayElement<T>, { name: K; protocol: any }>["protocol"]
      >;
    }
  : never;

// type X = FromEntries<[
//   { name: "a", protocol: Protocol<number> },
//   { name: "b", protocol: Protocol<bigint> },
// ]>

export let combined = <
  const T extends Array<
    | { name: string; protocol: Protocol<any> }
    | { name?: string; protocol: Protocol<void> }
  >,
>(
  parts: T
): Protocol<FromEntries<T>> => {
  return {
    encode: (value) => {
      return concat(
        parts.map(({ name, protocol }) =>
          name == null
            ? protocol.encode(undefined)
            : protocol.encode(value[name])
        )
      );
    },
    decode: (buffer) => {
      let result: any = {};
      let offset = 0;
      for (let { name, protocol } of parts) {
        try {
          let [value, value_offset] = protocol.decode(buffer.slice(offset));
          if (name != null) result[name] = value;
          offset = offset + value_offset;
        } catch (error: any) {
          throw error;
          // throw new DecodeError({ operator: "combine", cause: error });
        }
      }
      return [result, offset];
    },
  };
};

let with_int16_length_protocol = combined([
  { name: "length", protocol: bytes.int16 },
  { name: "data", protocol: native.uint8array },
]);
export let with_int16_length = <T>(protocol: Protocol<T>): Protocol<T> => {
  return {
    encode: (value) => {
      let buffer = protocol.encode(value);
      return with_int16_length_protocol.encode({
        length: buffer.length,
        data: buffer,
      });
    },
    decode: (buffer) => {
      let [{ length, data }, offset] =
        with_int16_length_protocol.decode(buffer);
      let [decoded, decoded_offset] = protocol.decode(data.slice(0, length));
      return [decoded, offset + decoded_offset];
    },
  };
};

export let wrap = <ToBuffer, ToApplication>({
  protocol,
  encode,
  decode,
}: {
  protocol: Protocol<ToBuffer>;
  encode: (external: ToApplication) => ToBuffer;
  decode: (internal: ToBuffer) => ToApplication;
}): Protocol<ToApplication> => {
  return {
    encode: (value) => protocol.encode(encode(value)),
    decode: (buffer) => {
      let [decoded, offset] = protocol.decode(buffer);
      return [decode(decoded), offset];
    },
  };
};

type TypeAndValue2<Type, Value> = Value extends undefined
  ? { type: Type }
  : { type: Type; value: Value };

export let switch_on_type2 = <
  const Type,
  const Protocols extends {
    [key: string]: { type: Type; value: Protocol<any> };
  },
>(
  type_from_prefix: Protocol<Type>,
  items: Protocols
): Protocol<
  {
    [Prefix in keyof Protocols]: TypeAndValue2<
      Prefix,
      ValueOfProtocol<Protocols[Prefix]["value"]>
    >;
    //   type: Prefix;
    //   value: ValueOfProtocol<Protocols[Prefix]>;
    // };
  }[keyof Protocols]
> => {
  return {
    encode: (value) => {
      let item = items[value.type];
      if (!item) {
        // @ts-ignore
        throw new Error(`No protocol matched prefix ${value.type}`);
      }
      return concat([
        type_from_prefix.encode(item.type),
        item.value.encode("value" in value ? value.value : undefined),
      ]);
    },
    decode: (buffer) => {
      let [type, offset] = type_from_prefix.decode(buffer);

      let protocol = Object.entries(items).find(
        ([key, item]) => item.type === type
      );
      if (!protocol) {
        console.log(`items:`, items);
        console.log(`type:`, type);
        console.log(`Object.entries(items):`, Object.entries(items));
        // @ts-ignore
        throw new Error(`No protocol matched prefix ${type}`);
      }

      let [key, { type: x, value }] = protocol as any;

      try {
        let [result, length] = value.decode(buffer.subarray(offset));
        return [
          result === undefined ? { type: key } : { type: key, value: result },
          offset + length,
        ] as any;
      } catch (e) {
        console.error("switch_on_type, Error decoding", {
          type,
          buffer: buffer.subarray(offset),
        });
        throw e;
      }
    },
  };
};

// let p = switch_on_type2(native.string, {
//   "minecraft:custom_data": {
//     type: "WOW",
//     value: native.string,
//   },
//   "minecraft:lore": {
//     type: "HI",
//     value: native.string
//   },
//   "minecraft:rarity": {
//     type: "BRR",
//     value: native.string
//   },
// })

// type X = ValueOfProtocol<typeof p>
