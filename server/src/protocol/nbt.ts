import { mapValues, range, sumBy } from "lodash-es";
import fs from "fs/promises";
import {
  bytes,
  combined,
  native,
  prefilled,
  type ValueOfProtocol,
  type Protocol,
  switch_on_type,
  concat,
} from "./protocol.ts";

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

export type NamedNBT<T extends NBT = NBT> = {
  type: T["type"];
  value: {
    name: string;
    value: T["value"];
  };
};
export type NBT =
  | { type: "compound"; value: Array<NamedNBT<NBT>> }
  | { type: "list"; value: Array<NBT> }
  | { type: "string"; value: string }
  | { type: "int"; value: number }
  | { type: "byte"; value: number }
  | { type: "double"; value: number }
  | { type: "float"; value: number }
  | { type: "long"; value: bigint }
  | { type: "int_array"; value: Array<number> }
  | { type: "long_array"; value: Array<bigint> };

let repeat = <T>(
  protocol: Protocol<T>,
  options: { until: Protocol<void> }
): Protocol<Array<T>> => {
  return {
    encode: (items) => {
      return concat([
        ...items.map((item) => protocol.encode(item)),
        options.until.encode(),
      ]);
    },
    decode: (buffer) => {
      let items: Array<T> = [];

      let offset = 0;
      while (offset < buffer.length) {
        try {
          let [_, length] = options.until.decode(buffer.subarray(offset));
          offset = offset + length;
          break;
        } catch {
          try {
            let [item, length] = protocol.decode(buffer.subarray(offset));
            if (length === 0) {
              throw new Error(
                "Repeatable protocol must consume at least 1 byte"
              );
            }

            items.push(item);
            offset = offset + length;
          } catch (error) {
            console.log(`IN REPEAT buffer:`, buffer);
            console.log(`current:`, buffer.subarray(offset));
            console.log(`items:`, items);
            throw error;
          }
        }
      }
      return [items, offset];
    },
  };
};

let lazy = <T>(protocol: () => Protocol<T>): Protocol<T> => {
  return {
    encode: (value) => protocol().encode(value),
    decode: (buffer) => protocol().decode(buffer),
  };
};

let nbt_variant = <T>({
  prefix,
  protocol,
}: {
  prefix: number;
  protocol: Protocol<T>;
}) => {
  return {
    prefix: prefix,
    basic: protocol,
    standalone: combined([
      { protocol: prefilled(bytes.uint8, prefix) },
      {
        name: "name",
        protocol: native.with_byte_length(bytes.uint16, native.string),
      },
      { name: "value", protocol: protocol },
    ]),
    network: combined([
      { protocol: prefilled(bytes.uint8, prefix) },
      { name: "value", protocol: protocol },
    ]),
  };
};

let nbt_variants = {
  string: nbt_variant({
    prefix: NBT_TAGS.TAG_String,
    protocol: native.with_byte_length(bytes.uint16, native.string),
  }),
  byte: nbt_variant({ prefix: NBT_TAGS.TAG_Byte, protocol: bytes.int8 }),
  short: nbt_variant({ prefix: NBT_TAGS.TAG_Short, protocol: bytes.int16 }),
  int: nbt_variant({ prefix: NBT_TAGS.TAG_Int, protocol: bytes.int32 }),
  long: nbt_variant({ prefix: NBT_TAGS.TAG_Long, protocol: bytes.int64 }),
  float: nbt_variant({ prefix: NBT_TAGS.TAG_Float, protocol: bytes.float32 }),
  double: nbt_variant({
    prefix: NBT_TAGS.TAG_Double,
    protocol: bytes.float64,
  }),
  byte_array: nbt_variant({
    prefix: NBT_TAGS.TAG_Byte_Array,
    protocol: native.with_byte_length(bytes.int32, native.uint8array),
  }),
  int_array: nbt_variant({
    prefix: NBT_TAGS.TAG_Int_Array,
    protocol: native.repeated(bytes.int32, bytes.int32),
  }),
  long_array: nbt_variant({
    prefix: NBT_TAGS.TAG_Long_Array,
    protocol: native.repeated(bytes.int32, bytes.int64),
  }),
  list: nbt_variant({
    prefix: NBT_TAGS.TAG_List,
    protocol: {
      encode: (value: Array<any>) => {
        if (value.length === 0) {
          return concat([bytes.uint8.encode(0), bytes.int32.encode(0)]);
        } else {
          let type = value[0].type;
          let matching_nbt = nbt_variants[type];
          if (!matching_nbt) {
            throw new Error(`No matching nbt for tag ${type}`);
          }

          return concat([
            TagsEnum.encode(type),
            bytes.int32.encode(value.length),
            ...value.map((item) => matching_nbt.basic.encode(item.value)),
          ]);
        }
      },
      decode: (buffer) => {
        let [{ type, count }, header_offset] = combined([
          { name: "type", protocol: TagsEnum },
          { name: "count", protocol: bytes.int32 },
        ]).decode(buffer);

        if (count === 0) {
          return [[], header_offset];
        }

        let rest = buffer.slice(header_offset);

        let matching_nbt = nbt_variants[type];
        if (!matching_nbt) {
          throw new Error(`No matching nbt for tag ${type}`);
        }

        let items: Array<any> = [];
        let offset = 0;
        for (let i of range(count)) {
          try {
            let [item, length] = matching_nbt.basic.decode(rest.slice(offset));
            // items.push(item);
            items.push({
              type,
              value: item,
            });
            offset = offset + length;
          } catch (error) {
            console.log(`matching_nbt:`, matching_nbt);
            console.log(`IN LIST ${i}, fullbuffer:`, buffer);
            throw error;
          }
        }
        return [items, header_offset + offset];
      },
    },
  }),
  compound: nbt_variant({
    prefix: NBT_TAGS.TAG_Compound,
    protocol: lazy(() => nbt_compound) as Protocol<NBT & { type: "compound" }>,
  }),
};

let TagsEnum = native.enum(bytes.uint8, [
  "_",
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
  "byte_array",
  "string",
  "list",
  "compound",
  "int_array",
  "long_array",
]);

export let any_network = switch_on_type(
  TagsEnum as any,
  mapValues(nbt_variants, (x) => x.basic)
);
export let any_standalone = switch_on_type(
  TagsEnum as any,
  mapValues(nbt_variants, (x) =>
    combined([
      {
        name: "name",
        protocol: native.with_byte_length(bytes.uint16, native.string),
      },
      { name: "value", protocol: x.basic },
    ])
  )
);

let nbt_compound = repeat(
  lazy(() => any_standalone),
  // any_standalone,
  {
    until: prefilled(bytes.uint8, NBT_TAGS.TAG_End),
  }
);

export let nbt = {
  ...nbt_variants,
  any: {
    network: any_network as Protocol<NBT>,
    standalone: any_standalone as Protocol<NamedNBT>,
  },
};
