import {
  encode_combined,
  type Protocol as ProtocolBoring,
} from "@2weeks/binary-protocol/Protocol";
import { decode_varint, encode_varint } from "@2weeks/binary-protocol/varint";
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
} from "@2weeks/binary-protocol/bytes";
import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { chunk, sumBy } from "lodash-es";

let encode_list = (values: Array<Uint8Array>) => {
  return encode_combined([encode_varint(values.length), ...values]);
};
let decode_list = <T>(
  protocol: ProtocolBoring<T>
): ProtocolBoring<Array<T>> => {
  return (buffer: Uint8Array) => {
    let [length, offset] = decode_varint(buffer);
    let values: Array<T> = [];
    for (let i = 0; i < length; i++) {
      let [value, value_offset] = protocol(buffer.slice(offset));
      values.push(value);
      offset = value_offset + offset;
    }
    return [values, offset];
  };
};

type Protocol<T> = {
  encode: (value: T) => Uint8Array;
  decode: (buffer: Uint8Array) => [T, number];
};
type ValueOfProtocol<T> = T extends Protocol<infer U> ? U : never;

let with_varint_length = <T>(protocol: Protocol<T>): Protocol<T> => {
  return {
    encode: (value: T) => {
      return encode_with_varint_length(protocol.encode(value));
    },
    decode: (buffer: Uint8Array) => {
      let [length, offset] = decode_varint(buffer);
      let [value, value_offset] = protocol.decode(
        buffer.slice(offset, offset + length)
      );

      if (length !== value_offset) {
        throw new Error(`Length mismatch: ${length} !== ${value_offset}`);
      }

      return [value, offset + length];
    },
  };
};

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
  } satisfies Protocol<Uint8Array>,
  empty: {
    encode: () => new Uint8Array([]),
    decode: (buffer: Uint8Array) => [undefined, 0],
  } satisfies Protocol<void>,
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
  /// Missing: uint64
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
    decode: decode_float64,
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
      return encode_combined(
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
        let [value, value_offset] = protocol.decode(buffer.slice(offset));
        if (name != null) result[name] = value;
        offset = offset + value_offset;
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

export let wrap = <Internal, External>({
  protocol,
  encode,
  decode,
}: {
  protocol: Protocol<Internal>;
  encode: (external: External) => Internal;
  decode: (internal: Internal) => External;
}): Protocol<External> => {
  return {
    encode: (value) => protocol.encode(encode(value)),
    decode: (buffer) => {
      let [decoded, offset] = protocol.decode(buffer);
      return [decode(decoded), offset];
    },
  };
};

let NBT_TAGS = {
  TAG_End: 0,
  TAG_Byte: 1,
  TAG_Short: 2,
  TAG_Int: 3,
  TAG_Long: 4,
  TAG_Float: 5,
  TAG_Double: 6,
  TAG_Byte_Array: 7,
  TAG_String: 8,
  TAG_List: 9,
  TAG_Compound: 10,
  TAG_Int_Array: 11,
  TAG_Long_Array: 12,
};
let nbt_internal_string = with_int16_length(native.string);
let nbt = {
  string: wrap({
    protocol: combined([
      { protocol: prefilled(bytes.uint8, NBT_TAGS.TAG_String) },
      { name: "value", protocol: nbt_internal_string },
    ]),
    encode: (value) => ({ value }),
    decode: (value) => value.value,
  }) satisfies Protocol<string>,

  string_named: combined([
    { protocol: prefilled(bytes.uint8, NBT_TAGS.TAG_String) },
    { name: "name", protocol: nbt_internal_string },
    { name: "value", protocol: nbt_internal_string },
  ]),

  // list: <T>(protocol: Protocol<T>): Protocol<Array<T>> => {
  //   return {
  //     encode: (values) => {
  //       if (values.length === 0) {

  //       }
  //       return encode_combined([
  //         encode_varint(values.length),
  //         ...values.map(protocol.encode),
  //       ]);
  //     },
  //     decode: (buffer) => {
  //       let [length, offset] = decode_varint(buffer);
  //       let values: Array<T> = [];
  //       for (let i = 0; i < length; i++) {
  //         let [value, value_offset] = protocol.decode(buffer.slice(offset));
  //         values.push(value);
  //         offset = offset + value_offset;
  //       }
  //       return [values, offset];
  //     },
  //   };
  // }

  // compound: wrap({
  //   protocol: combined([
  //     { protocol: prefilled(bytes.uint8, 0x0a) },
  //     {
  //       name: "entries",
  //       protocol: mcp.list(
  //         combined([
  //           { name: "name", protocol: nbt_internal_string },
  //           { name: "value", protocol: wrap({ protocol: nbt.root_string }) },
  //         ])
  //       ),
  //     },
  //     { protocol: prefilled(bytes.uint8, 0) },
  //   ]),
  //   encode: (value) => ({ entries: value }),
  //   decode: (value) => value.entries,
  // }),
  // compound_named: combined([
  //   { protocol: prefilled(bytes.uint8, 0x0a) },
  //   { name: "name", protocol: nbt_internal_string },
  //   {
  //     name: "entries",
  //     protocol: mcp.list(
  //       combined([
  //         { name: "name", protocol: nbt_internal_string },
  //         { name: "value", protocol: wrap({ protocol: nbt.root_string }) },
  //       ])
  //     ),
  //   },
  // ]),
};

let concat = (buffers: Array<Uint8Array>) => {
  let length = sumBy(buffers, (buffer) => buffer.length);
  let result = new Uint8Array(length);
  let offset = 0;
  for (let buffer of buffers) {
    result.set(buffer, offset);
    offset = offset + buffer.length;
  }
  return result;
};

export let mcp = {
  string: with_varint_length(native.string) satisfies Protocol<string>,
  varint: {
    encode: encode_varint,
    decode: decode_varint,
  } satisfies Protocol<number>,

  boolean: {
    encode: (value) => {
      return encode_uint8(value ? 1 : 0);
    },
    decode: (buffer) => {
      let [value, offset] = decode_uint8(buffer);
      if (value === 1) {
        return [true, offset];
      } else if (value === 0) {
        return [false, offset];
      } else {
        throw new Error(`Expected boolean, got ${value}`);
      }
    },
  } satisfies Protocol<boolean>,

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

  /**
   * A varint length prefixed list
   */
  list: <T>(protocol: Protocol<T>): Protocol<Array<T>> => {
    return {
      encode: (values) => {
        return encode_list(values.map(protocol.encode));
      },
      decode: (buffer) => {
        let [decoded, offset] = decode_list(protocol.decode)(buffer);
        return [decoded, offset];
      },
    };
  },

  bitmask: <const T>(possible_values: Array<T>): Protocol<Array<T>> => {
    return {
      encode: (values) => {
        let value = 0;
        for (let v of values) {
          let index = possible_values.indexOf(v);
          if (index === -1) {
            throw new Error(`Invalid bitmask value: ${v}`);
          }
          value = value | (1 << index);
        }
        return encode_uint8(value);
      },
      decode: (buffer) => {
        let [value, offset] = decode_uint8(buffer);
        let result: Array<T> = [];
        for (let i = 0; i < possible_values.length; i++) {
          if (value & (1 << i)) {
            result.push(possible_values[i]);
          }
        }
        return [result, offset];
      },
    };
  },

  optional: <T>(protocol: Protocol<T>): Protocol<T | null> => {
    return {
      encode: (value) => {
        if (value == null) {
          return mcp.boolean.encode(false);
        } else {
          return combined([
            { protocol: prefilled(mcp.boolean, true) },
            { name: "value", protocol: protocol },
          ]).encode({ value: value });
        }
      },
      decode: (buffer) => {
        let [has_value, offset] = mcp.boolean.decode(buffer);
        if (!has_value) {
          return [null, offset];
        }
        let [value, value_offset] = protocol.decode(buffer.slice(offset));
        return [value, value_offset + offset];
      },
    };
  },

  /**
   * This is currently just "string",
   * but does some stuff with json as well
   */
  text_component: nbt.string,

  json: wrap({
    protocol: with_varint_length(native.string),
    encode: JSON.stringify,
    decode: JSON.parse,
  }),
  json_weakly_typed: <T>() =>
    wrap<string, T>({
      protocol: with_varint_length(native.string),
      encode: JSON.stringify,
      decode: JSON.parse,
    }),
  /// TODO add strongly typed json with zod?

  switch_on: <
    const Keys extends string,
    const Cases extends { [K in Keys]: Protocol<any> },
  >(
    enum_protocol: Protocol<Keys>,
    cases: Cases
  ) => {
    return {
      encode: <const Key extends Keys>(input: {
        type: Key;
        value: ValueOfProtocol<Cases[Key]>;
      }) => {
        let case_protocol = cases[input.type];
        if (!case_protocol) {
          throw new Error(`Invalid switch case: ${input.type}`);
        }

        return concat([
          enum_protocol.encode(input.type),
          case_protocol.encode(input.value),
        ]);
      },
      decode: (buffer: Uint8Array) => {
        throw new Error("Not implemented");
        // let [{ [key]: key_value }, offset] = combined([
        //   { protocol: protocol },
        //   { protocol: prefilled(mcp.varint, 0) },
        // ]).decode(buffer);
        // let case_protocol = cases[key_value];
        // if (!case_protocol) {
        //   throw new Error(`Invalid switch case: ${key_value}`);
        // }
        // let [value, value_offset] = case_protocol.decode(buffer.slice(offset));
        // return [{ [key]: key_value, ...value }, offset + value_offset];
      },
    };
  },

  either: <T, U>(
    if_true: Protocol<T>,
    if_false: Protocol<U>
  ): Protocol<{ true: T } | { false: U }> => {
    return {
      encode: (value) => {
        if ("true" in value) {
          return concat([mcp.boolean.encode(true), if_true.encode(value.true)]);
        } else {
          return concat([
            mcp.boolean.encode(false),
            if_false.encode(value.false),
          ]);
        }
      },
      decode: (buffer) => {
        let [is_true, offset] = mcp.boolean.decode(buffer);
        if (is_true) {
          let [true_value, true_offset] = if_true.decode(buffer.slice(offset));
          return [{ true: true_value }, true_offset];
        } else {
          let [false_value, false_offset] = if_false.decode(
            buffer.slice(offset)
          );
          return [{ false: false_value }, false_offset];
        }
      },
    };
  },

  // any_network_nbt: {
  //   encode: (value: any) => {
  //     return nbt.string.encode(JSON.stringify(value));
  //   },
  //   decode: (buffer: Uint8Array) => {
  //     let [decoded, offset] = nbt.root_string.decode(buffer);
  //     return [JSON.parse(decoded), offset];
  //   },
  // },

  /** This does NOT return a protocol! */
  Packet: <
    const PacketId extends number,
    const T extends Array<
      | { name: string; protocol: Protocol<any> }
      | { name?: string; protocol: Protocol<void> }
    >,
  >(
    packet_id: PacketId,
    parts: T
  ) => {
    let base = combined([
      { protocol: prefilled(mcp.varint, packet_id) },
      ...parts,
    ]);
    let base_with_varint_length = with_varint_length(base);
    return {
      id: packet_id,
      /// Because my stream already does the varint length thing for reading
      /// My extra read doesn't do that...
      read: (buffer: Uint8Array) => {
        let [result, length] = base.decode(buffer);
        if (length !== buffer.length) {
          throw new Error(`Length mismatch: ${length} !== ${buffer.length}`);
        }
        return result;
      },
      /// BUT my writer don't add varint length thing automatically,
      /// So I need to do that here
      write: (
        value: Parameters<(typeof base_with_varint_length)["encode"]>[0]
      ) => {
        return base_with_varint_length.encode(value);
      },
    };
  },
};
