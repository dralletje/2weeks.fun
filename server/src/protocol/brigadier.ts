import { range } from "lodash-es";
import { mcp } from "../mcp.ts";
import { combined, native, type Protocol } from "../protocol.ts";
import { encode_int32 } from "@2weeks/binary-protocol/bytes";
import { registries } from "@2weeks/minecraft-data";

let parser_registry = registries["minecraft:command_argument_type"].entries;

let actual_optional = <T>(protocol: Protocol<T>) =>
  ({
    encode: (x) => {
      if (x == null) {
        return new Uint8Array([]);
      } else {
        return protocol.encode(x);
      }
    },
    decode: () => {
      throw new Error("Not implemented (and can't be in this form)");
    },
  }) satisfies Protocol<T | null>;

let command_node_write_only = combined([
  {
    name: "flags",
    protocol: mcp.bitmask([
      "is_literal",
      "is_argument",
      "has_executable",
      "has_redirect",
      "has_suggestions",
    ]),
  },
  {
    name: "children",
    protocol: mcp.list(mcp.varint),
  },
  {
    name: "redirect",
    protocol: actual_optional(mcp.varint),
  },
  {
    name: "name",
    protocol: actual_optional(mcp.string),
  },
  // {
  //   name: "parser_id",
  //   protocol: actual_optional(mcp.varint),
  // },
  {
    name: "properties",
    protocol: native.uint8array,
  },
  {
    name: "suggestion_type",
    protocol: actual_optional(mcp.string),
  },
]);

let encode_command_node = (node: CommandNodeFlat): Uint8Array => {
  if (node.type === "root") {
    return command_node_write_only.encode({
      flags: new Set(),
      children: node.children,
      redirect: null,
      name: null,
      // parser_id: null,
      properties: new Uint8Array([]),
      suggestion_type: null,
    });
  } else if (node.type === "literal") {
    return command_node_write_only.encode({
      flags: new Set([
        "is_literal",
        ...(node.is_executable ? (["has_executable"] as const) : []),
      ]),
      children: node.children,
      redirect: null,
      name: node.name,
      // parser_id: null,
      properties: new Uint8Array([]),
      suggestion_type: null,
    });
  } else if (node.type === "argument") {
    let q = encode_command_parser(node.parser);
    console.log(`q:`, q);
    let p = command_node_write_only.encode({
      flags: new Set([
        "is_argument",
        // ...(node.is_executable ? (["has_executable"] as const) : []),
        // ...(node.suggestion_type != null ? (["has_suggestions"] as const) : []),
      ]),
      children: node.children,
      redirect: null,
      name: node.name,
      // parser_id: 0,
      properties: q,
      suggestion_type: null,
    });
    console.log(`p:`, p);
    return p;
  } else {
    // @ts-expect-error
    throw new Error(`Unknown node type: ${node.type}`);
  }
};

export let brigadier_node = {
  write: (node: CommandNodeFlat) => {
    return encode_command_node(node);
  },
  read: (buffer: Uint8Array) => {
    throw new Error("Not implemented");
  },
};

let bytes = {
  double: (value: number) => new Uint8Array(new Float64Array([value]).buffer),
  float: (value: number) => new Uint8Array(new Float32Array([value]).buffer),
  int: (value: number) => encode_int32(value),
  long: (value: number) =>
    new Uint8Array(new BigInt64Array([BigInt(value)]).buffer),
  string: mcp.string.encode,
};

/// Thanks copilot
let encode_command_parser = (parser: CommandParser): Uint8Array => {
  let protocol_id = parser_registry[parser.type]?.protocol_id;
  if (protocol_id == null) {
    throw new Error(`Unknown parser: ${parser.type}`);
  }

  if (parser.type === "brigadier:double") {
    return new Uint8Array([
      protocol_id,
      (parser.min == null ? 0 : 0x01) | (parser.max == null ? 0 : 0x02),
      ...(parser.min == null ? new Uint8Array() : bytes.double(parser.min)),
      ...(parser.max == null ? new Uint8Array() : bytes.double(parser.max)),
    ]);
  } else if (parser.type === "brigadier:float") {
    return new Uint8Array([
      protocol_id,
      (parser.min == null ? 0 : 0x01) | (parser.max == null ? 0 : 0x02),
      ...(parser.min == null ? new Uint8Array() : bytes.float(parser.min)),
      ...(parser.max == null ? new Uint8Array() : bytes.float(parser.max)),
    ]);
  } else if (parser.type === "brigadier:integer") {
    return new Uint8Array([
      protocol_id,
      (parser.min == null ? 0 : 0x01) | (parser.max == null ? 0 : 0x02),
      ...(parser.min == null ? new Uint8Array() : bytes.int(parser.min)),
      ...(parser.max == null ? new Uint8Array() : bytes.int(parser.max)),
    ]);
  } else if (parser.type === "brigadier:long") {
    return new Uint8Array([
      protocol_id,
      (parser.min == null ? 0 : 0x01) | (parser.max == null ? 0 : 0x02),
      ...(parser.min == null ? new Uint8Array() : bytes.long(parser.min)),
      ...(parser.max == null ? new Uint8Array() : bytes.long(parser.max)),
    ]);
  } else if (parser.type === "brigadier:string") {
    let behavior =
      parser.behavior === "SINGLE_WORD"
        ? 0
        : parser.behavior === "QUOTABLE_PHRASE"
          ? 1
          : 2;
    return new Uint8Array([protocol_id, behavior]);
  } else if (parser.type === "minecraft:entity") {
    return new Uint8Array([
      protocol_id,
      (parser.multiple ? 0x00 : 0x01) | (parser.only_players ? 0x02 : 0x00),
    ]);
  } else if (parser.type === "minecraft:score_holder") {
    return new Uint8Array([protocol_id, parser.multiple ? 0 : 1]);
  } else if (parser.type === "minecraft:time") {
    return new Uint8Array([protocol_id, ...bytes.int(parser.min)]);
  } else if (
    parser.type === "minecraft:resource_or_tag" ||
    parser.type === "minecraft:resource" ||
    parser.type === "minecraft:resource_or_tag_key" ||
    parser.type === "minecraft:resource_key"
  ) {
    return new Uint8Array([protocol_id, ...bytes.string(parser.registry)]);
  } else {
    return new Uint8Array([protocol_id]);
  }
};

export type CommandParser =
  | { type: "brigadier:bool" }
  | { type: "brigadier:double"; min?: number; max?: number }
  | { type: "brigadier:float"; min?: number; max?: number }
  | { type: "brigadier:integer"; min?: number; max?: number }
  | { type: "brigadier:long"; min?: number; max?: number }
  | {
      type: "brigadier:string";
      behavior: "SINGLE_WORD" | "QUOTABLE_PHRASE" | "GREEDY_PHRASE";
    }
  | { type: "minecraft:entity"; multiple: boolean; only_players: boolean }
  /// Argumentless:
  | { type: "minecraft:game_profile" }
  | { type: "minecraft:block_pos" }
  | { type: "minecraft:column_pos" }
  | { type: "minecraft:vec3" }
  | { type: "minecraft:vec2" }
  | { type: "minecraft:block_state" }
  | { type: "minecraft:block_predicate" }
  | { type: "minecraft:item_stack" }
  | { type: "minecraft:item_predicate" }
  | { type: "minecraft:color" }
  | { type: "minecraft:component" }
  | { type: "minecraft:style" }
  | { type: "minecraft:message" }
  | { type: "minecraft:nbt_compound_tag" }
  | { type: "minecraft:nbt_tag" }
  | { type: "minecraft:nbt_path" }
  | { type: "minecraft:objective" }
  | { type: "minecraft:objective_criteria" }
  | { type: "minecraft:operation" }
  | { type: "minecraft:particle" }
  | { type: "minecraft:angle" }
  | { type: "minecraft:rotation" }
  | { type: "minecraft:scoreboard_slot" }
  /// Argumentful
  | { type: "minecraft:score_holder"; multiple: boolean }
  /// Argumentless
  | { type: "minecraft:swizzle" }
  | { type: "minecraft:team" }
  | { type: "minecraft:item_slot" }
  | { type: "minecraft:item_slots" }
  | { type: "minecraft:resource_location" }
  | { type: "minecraft:function" }
  | { type: "minecraft:entity_anchor" }
  | { type: "minecraft:int_range" }
  | { type: "minecraft:float_range" }
  | { type: "minecraft:dimension" }
  | { type: "minecraft:gamemode" }
  /// Argumentful
  | { type: "minecraft:time"; min: number }
  | { type: "minecraft:resource_or_tag"; registry: string }
  | { type: "minecraft:resource_or_tag_key"; registry: string }
  | { type: "minecraft:resource"; registry: string }
  | { type: "minecraft:resource_key"; registry: string }
  | { type: "minecraft:template_mirror" }
  /// Argumentless
  | { type: "minecraft:template_rotation" }
  | { type: "minecraft:heightmap" }
  | { type: "minecraft:loot_modifier" }
  | { type: "minecraft:loot_predicate" }
  | { type: "minecraft:loot_table" }
  | { type: "minecraft:uuid" };

export type SuggestionType =
  | "minecraft:ask_server"
  | "minecraft:all_recipes"
  | "minecraft:available_sounds"
  | "minecraft:summonable_entities";

export type CommandNodeFlat =
  | { type: "root"; children: Array<number> }
  | {
      type: "literal";
      name: string;
      is_executable: boolean;
      children: Array<number>;
    }
  | {
      type: "argument";
      name: string;
      is_executable: boolean;
      children: Array<number>;
      parser: CommandParser;
      suggestion_type?: string;
    };

export type CommandNode =
  | { type: "root"; children: Array<CommandNode> }
  | {
      type: "literal";
      name: string;
      is_executable: boolean;
      children: Array<CommandNode>;
    }
  | {
      type: "argument";
      name: string;
      is_executable: boolean;
      children: Array<CommandNode>;
      parser: CommandParser;
      suggestion_type?: string;
    };

class VeryMutableCollector {
  private nodes = new Map<number, CommandNodeFlat>();
  private ids = new Map<CommandNode, number>();
  private last_index = 0;

  add(node: CommandNode): number {
    if (this.ids.has(node)) {
      return this.ids.get(node)!;
    }

    let id = this.last_index;
    this.ids.set(node, id);
    this.last_index += 1;

    if (node.type === "root") {
      let ids = node.children.map((child) => this.add(child));
      this.nodes.set(id, {
        type: "root",
        children: ids,
      });
    } else if (node.type === "literal") {
      this.nodes.set(id, {
        type: "literal",
        name: node.name,
        is_executable: node.is_executable,
        children: node.children.map((child) => this.add(child)),
      });
    } else if (node.type === "argument") {
      this.nodes.set(id, {
        type: "argument",
        name: node.name,
        is_executable: node.is_executable,
        children: node.children.map((child) => this.add(child)),
        parser: node.parser,
        suggestion_type: node.suggestion_type,
      });
    } else {
      // @ts-ignore
      throw new Error(`Unknown node type: ${node.type}`);
    }

    return id;
  }

  get(): Array<CommandNodeFlat> {
    return range(0, this.last_index).map((i) => {
      let node = this.nodes.get(i);
      if (node == null) {
        throw new Error(`Missing node: ${i}`);
      }
      return node;
    });
  }
}

export let flatten_command_node = (
  root: CommandNode
): {
  nodes: Array<CommandNodeFlat>;
  root_index: number;
} => {
  let collector = new VeryMutableCollector();
  let id = collector.add(root);
  return {
    nodes: collector.get(),
    root_index: id,
  };
};
