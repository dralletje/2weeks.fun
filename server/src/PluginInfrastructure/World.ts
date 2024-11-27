import { type BlockDefinition, type BlockState } from "@2weeks/minecraft-data";
import { BasicPlayer } from "../PluginInfrastructure/BasicPlayer.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import { type ChunkPosition, type Position } from "./MinecraftTypes.ts";
import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { type NBT } from "../protocol/nbt.ts";
import { Record } from "@dral/records-and-tuples";
import { type Drivers_v1 } from "./Plugin_v1.ts";
import { MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";

export type ChunkData_v1 = {
  position: ChunkPosition;
  blocks: Array<{
    state: number;
    entity?: {
      type: RegistryResourceKey<"minecraft:block_entity_type">;
      data: NBT;
    };
  }>;
};

/**
 * This is the interface visible for plugins.
 * The world exposed to the driver will have more methods than this.
 */
export abstract class World {
  abstract bottom: number;
  abstract top: number;

  players = new MapStateSignal<bigint, BasicPlayer>();
  abstract set_block(options: {
    position: Position;
    block: number;
    block_entity?: {
      type: RegistryResourceKey<"minecraft:block_entity_type">;
      data: NBT;
    };
    transaction_id?: number;
  }): void;
  abstract set_blocks(options: {
    blocks: Array<{
      position: { x: number; y: number; z: number };
      blockstate: number;
    }>;
    transaction_id?: number;
  }): void;
  abstract get_block(options: { position: Position }): {
    name: RegistryResourceKey<"minecraft:block">;
    blockstate: BlockState;
    block: BlockDefinition;
  };
}

export abstract class ServerWorld_v1 {
  abstract public(): World;
  abstract map_drivers<Drivers>(drivers: Drivers): Drivers;
  abstract join({
    player,
    socket,
    signal,
  }: {
    player: BasicPlayer;
    socket: MinecraftPlaySocket;
    signal: AbortSignal;
  }): void;
}
