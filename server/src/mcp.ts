import { decode_varint, encode_varint } from "@2weeks/binary-protocol/varint";
import { encode_uint8, decode_uint8 } from "@2weeks/binary-protocol/bytes";
import {
  bytes,
  combined,
  concat,
  native,
  prefilled,
  wrap,
  type ValueOfProtocol,
  type Protocol,
} from "./protocol.ts";
import { text_component } from "./protocol/text-component.ts";

let mcp_varint = {
  encode: encode_varint,
  decode: decode_varint,
} satisfies Protocol<number>;

let with_varint_length = <T>(protocol: Protocol<T>): Protocol<T> =>
  native.with_byte_length(mcp_varint, protocol);

let interpret_as_signed = (value: bigint, bits: bigint) => {
  if (value >= 1n << (bits - 1n)) {
    return value - (1n << bits);
  } else {
    return value;
  }
};

export let mcp = {
  string: with_varint_length(native.string) satisfies Protocol<string>,
  varint: mcp_varint,

  /// ALIASES
  /** Alias for `bytes.uint128` */
  UUID: bytes.uint128,
  Byte: bytes.int8,
  UnsignedByte: bytes.uint8,
  Short: bytes.int16,
  UnsignedShort: bytes.uint16,
  Int: bytes.int32,
  Long: bytes.int64,
  Float: bytes.float32,
  Double: bytes.float64,
  Angle: bytes.int8,
  /**
   * x, y, z position packed up in a single 64 bit integer
   * https://wiki.vg/Protocol#Position
   */
  Position: wrap({
    protocol: bytes.uint64,
    decode: (value) => {
      let y_mask =
        0b0000000000000000000000000000000000000000000000000000111111111111n;
      let z_mask =
        0b0000000000000000000000000011111111111111111111111111000000000000n;

      return {
        x: Number(interpret_as_signed(value >> (26n + 12n), 26n)),
        y: Number(interpret_as_signed(value & y_mask, 12n)),
        z: Number(interpret_as_signed((value & z_mask) >> 12n, 26n)),
      };
    },
    encode: (position) => {
      let x = BigInt(Math.floor(position.x));
      let y = BigInt(Math.floor(position.y));
      let z = BigInt(Math.floor(position.z));

      let bits_26 = 0b11111111111111111111111111n;
      let bits_12 = 0b111111111111n;

      return (
        ((x & bits_26) << (26n + 12n)) |
        ((z & bits_26) << BigInt(12)) |
        (y & bits_12)
      );
    },
  }) satisfies Protocol<{ x: number; y: number; z: number }>,

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

  enum: native.enum,

  /**
   * A varint length prefixed list
   */
  list: <T>(protocol: Protocol<T>): Protocol<Array<T>> =>
    native.repeated(mcp_varint, protocol) as any,
  // list: <T>(protocol: Protocol<T>): Protocol<Array<T>> => {
  //   return {
  //     encode: (values) => {
  //       let value_buffers = values.map(protocol.encode);
  //       return concat([encode_varint(values.length), ...value_buffers]);
  //     },
  //     decode: (buffer: Uint8Array) => {
  //       let [length, offset] = decode_varint(buffer);
  //       let values: Array<T> = [];
  //       for (let i = 0; i < length; i++) {
  //         let [value, value_offset] = protocol.decode(buffer.slice(offset));
  //         values.push(value);
  //         offset = value_offset + offset;
  //       }
  //       return [values, offset];
  //     },
  //   };
  // },

  bitmask: <const T>(possible_values: Array<T>): Protocol<Set<T>> => {
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
        return [new Set(result), offset];
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

  text_component: text_component,

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

  /**
   * @deprecated Use `switch_on_type` instead
   */
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
        let [type, offset] = enum_protocol.decode(buffer);

        let protocol = cases[type];
        if (!protocol) {
          // @ts-ignore
          throw new Error(`No protocol matched prefix ${type}`);
        }

        let [result, length] = protocol.decode(buffer.subarray(offset));
        let final_offer = { type, value: result };
        return [final_offer, offset + length] as [typeof final_offer, number];
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
    let base = with_varint_length(
      combined([{ protocol: prefilled(mcp.varint, packet_id) }, ...parts])
    );
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
      write: (value: Parameters<(typeof base)["encode"]>[0]) => {
        return base.encode(value);
      },
    };
  },
};
