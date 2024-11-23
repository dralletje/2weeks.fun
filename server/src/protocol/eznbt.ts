import { uniq } from "lodash-es";
import { type NBT, nbt } from "./nbt.ts";
import { type Protocol, wrap } from "../protocol.ts";

class NBTSpecialValue {}

class NBTIntArray extends NBTSpecialValue {
  type = "int_array" as const;
  value: number[];
  constructor(value: number[]) {
    super();
    this.value = value;
  }
}

class NBTLongArray extends NBTSpecialValue {
  type = "long_array" as const;
  value: bigint[];
  constructor(value: bigint[]) {
    super();
    this.value = value;
  }
}

class NBTInt extends NBTSpecialValue {
  type = "int" as const;
  value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
}

type JSON =
  | { [key: string]: JSON }
  | Array<JSON>
  | string
  | number
  | boolean
  | bigint
  | NBTSpecialValue;

let json_to_nbtish = (json: JSON): NBT => {
  if (Array.isArray(json)) {
    let list = json.map(json_to_nbtish);

    if (
      list.length !== 0 &&
      !list.every((item) => item.type === list[0].type)
    ) {
      // prettier-ignore
      throw new Error(`List contains multiple types: ${uniq(list.map((x) => x.type))}`);
    }

    return {
      type: "list",
      value: json.map(json_to_nbtish),
    };
  } else if (typeof json === "object") {
    if (json instanceof NBTIntArray) {
      return {
        type: "int_array",
        value: json.value,
      };
    } else if (json instanceof NBTSpecialValue) {
      throw new Error(`Invalid JSON value: ${json}`);
    } else {
      return {
        type: "compound",
        value: Object.entries(json).map(([key, value]) => {
          let x = json_to_nbtish(value);
          return {
            type: x.type,
            value: {
              name: key,
              value: x.value,
            },
          };
        }),
      };
    }
  } else if (typeof json === "string") {
    return {
      type: "string",
      value: json,
    };
  } else if (typeof json === "number") {
    return {
      type: "int",
      value: json,
    };
  } else if (typeof json === "boolean") {
    return {
      type: "byte",
      value: json ? 1 : 0,
    };
  } else if (typeof json === "bigint") {
    return {
      type: "long",
      value: json,
    };
  } else {
    throw new Error(`Invalid JSON value: ${json}`);
  }
};

let nbtish_to_json = (nbt: NBT): JSON => {
  if (nbt.type === "compound") {
    let obj: { [key: string]: JSON } = {};
    for (let entry of nbt.value) {
      obj[entry.value.name] = nbtish_to_json({
        type: entry.type,
        value: entry.value.value as any,
      });
    }
    return obj;
  } else if (nbt.type === "list") {
    return nbt.value.map(nbtish_to_json);
  } else if (nbt.type === "string") {
    return nbt.value;
  } else if (nbt.type === "int") {
    return new NBTInt(nbt.value);
  } else if (nbt.type === "byte") {
    return nbt.value === 1;
  } else if (nbt.type === "double") {
    return nbt.value;
  } else if (nbt.type === "float") {
    return nbt.value;
  } else if (nbt.type === "long") {
    return nbt.value;
  } else if (nbt.type === "int_array") {
    return new NBTIntArray(nbt.value);
  } else if (nbt.type === "long_array") {
    return new NBTLongArray(nbt.value);
  } else {
    console.log(`nbt:`, nbt);
    // @ts-expect-error
    throw new Error(`Invalid NBT type: ${nbt.type} (${nbt})`);
  }
};

export let eznbt = wrap({
  protocol: nbt.any.network as any,
  encode: (json: JSON) => json_to_nbtish(json),
  decode: (nbt: NBT) => nbtish_to_json(nbt),
}) satisfies Protocol<JSON>;
