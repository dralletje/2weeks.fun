import { uniq } from "lodash-es";
import { nbt } from "../nbt-read.ts";
import { type Protocol, wrap } from "../protocol.ts";

type JSON = { [key: string]: JSON } | Array<JSON> | string | number | boolean;

type NamedNBT<T extends NBT> = {
  type: T["type"];
  value: {
    name: string;
    value: T["value"];
  };
};
type NBT =
  | {
      type: "compound";
      value: Array<NamedNBT<NBT>>;
    }
  | {
      type: "list";
      value: Array<NBT>;
    }
  | {
      type: "string";
      value: string;
    }
  | {
      type: "int";
      value: number;
    }
  | {
      type: "byte";
      value: number;
    };

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
  } else {
    throw new Error(`Invalid JSON value: ${json}`);
  }
};

export let nbt_json = wrap({
  protocol: nbt.any.network,
  encode: (json) => json_to_nbtish(json),
  decode: (nbt) => {
    throw new Error("Not implemented");
  },
}) satisfies Protocol<JSON>;
