import packets from "./packets.json" with { type: "json" };
import _blocks from "./blocks.json" with { type: "json" };
import _registries from "./registries.json" with { type: "json" };

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
type BlockDefinition = {
  definition: {
    type: string;
    [key: string]: string;
  };
  properties?: Record<string, string[]>;
  states: Array<BlockState>;
};

export let blocks = _blocks as Record<string, BlockDefinition>;

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

export let find_inside_registry_id = (registry: Registry & any, id: number) => {
  for (let [name, entry] of Object.entries(registry.entries)) {
    // @ts-ignore
    if (entry.protocol_id === id) {
      return name;
    }
  }
  throw new Error(`No registry entry with id ${id}`);
};
