import packets from "./packets.json" with { type: "json" };
import _blocks from "./blocks.json" with { type: "json" };
import _registries from "./registries.json" with { type: "json" };
import { isEmpty, isEqual } from "lodash-es";
import { type RegistryResourceKey } from "./registries.ts";

// registries

export type ConnectionState =
  | "handshake"
  | "status"
  | "login"
  | "play"
  | "configuration";
export type ConnectionDirection = "serverbound" | "clientbound";

export { packets };

export let find_packet_name = ({
  id,
  state,
  direction,
}: {
  id: number;
  state: ConnectionState;
  direction: ConnectionDirection;
}) => {
  if (state === "handshake") {
    if (direction === "clientbound") {
      throw new Error("Handshake packets are only serverbound");
    }
    let name = Object.entries(packets.handshake.serverbound).find(
      ([name, packet]) => packet.protocol_id === id
    )?.[0];
    if (name == null) {
      throw new Error(`No handshake packet with id ${id}`);
    }
    return name;
  } else {
    let state_packets = packets[state][direction];
    let name = Object.entries(state_packets).find(
      ([name, packet]) => packet.protocol_id === id
    )?.[0];
    if (name == null) {
      throw new Error(`No ${state} ${direction} packet with id ${id}`);
    }
    return name;
  }
};

export type BlockState = {
  default?: boolean;
  id: number;
  properties?: { [key: string]: string };
};
export type BlockDefinition = {
  definition: {
    type: RegistryResourceKey<"minecraft:block_type">;
    [key: string]: string;
  };
  properties?: Record<string, string[]>;
  states: Array<BlockState>;
};

export let blocks = _blocks as Record<
  RegistryResourceKey<"minecraft:block">,
  BlockDefinition
>;

// export let id_to_block = new Map<
//   number,
//   {
//     name: RegistryResourceKey<"minecraft:block">;
//     block: BlockDefinition;
//     state: BlockState;
//   }
// >(
//   Object.entries(blocks).flatMap(([name, block]) =>
//     block.states.map((state) => [state.id, { name, block, state }])
//   ) as any
// );

let id_to_block_object = {};
for (let [name, block] of Object.entries(blocks)) {
  for (let state of block.states) {
    id_to_block_object[state.id] = { name, block, state };
  }
}
export let id_to_block = {
  get(id: number) {
    return id_to_block_object[id];
  },
};

export let require_block_by_properties = (
  block: BlockDefinition,
  properties: { [key: string]: string }
): BlockState => {
  let state = get_block_by_properties(block, properties);
  if (state == null) {
    throw new Error(
      `No ${block.definition.type} with properties ${JSON.stringify(properties)}`
    );
  }
  return state;
};

export let get_block_by_definition = (
  type: RegistryResourceKey<"minecraft:block_type">,
  definition: { [key: string]: string }
) => {
  blocks: for (let [name, block] of Object.entries(blocks)) {
    if (block.definition.type === type) {
      for (let [key, value] of Object.entries(definition)) {
        if (block.definition[key] !== value) {
          continue blocks;
        }
      }
      return block;
    }
  }
  return null;
};

export let get_block_by_properties = (
  block: BlockDefinition,
  properties: { [key: string]: string }
): BlockState | null => {
  let default_state = block.states.find((x) => x.default)!;

  if (isEmpty(block.properties) && isEmpty(properties)) {
    return default_state;
  }

  /// Check if all properties are valid
  for (let [key, value] of Object.entries(properties)) {
    if (block.properties?.[key] == null) {
      /// Property does not exist
      return null;
    }
    if (!block.properties?.[key].includes(value)) {
      /// Value is not valid
      return null;
    }
  }

  /// Merge with default properties
  let properties_to_match = {
    ...default_state.properties,
    ...properties,
  };

  /// Find matching state
  for (let state of block.states) {
    if (isEqual(state.properties, properties_to_match)) {
      return state;
    }
  }
  return null;
};

let block_id_map = new Map<number, { name: string; state: BlockState }>();
for (let [name, block] of Object.entries(blocks)) {
  for (let state of block.states) {
    block_id_map.set(state.id, { name: name, state: state });
  }
}

export let find_block_for_id = (id: number) => {
  let block = block_id_map.get(id);
  if (block == null) {
    throw new Error(`No block with id ${id}`);
  }
  return block;
};

type Registry = { [key: string]: { protocol_id: number } };

export let registries = _registries;

export let find_inside_registry_id = <
  const T extends { entries: { [key: string]: { protocol_id: number } } },
>(
  registry: T["entries"],
  id: number
): keyof T => {
  for (let [name, entry] of Object.entries(registry.entries)) {
    // @ts-ignore
    if (entry.protocol_id === id) {
      return name as any;
    }
  }
  throw new Error(`No registry entry with id ${id}`);
};
