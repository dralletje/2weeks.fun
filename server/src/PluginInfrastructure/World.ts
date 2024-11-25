import { type BlockDefinition, type BlockState } from "@2weeks/minecraft-data";
import { BasicPlayer } from "../BasicPlayer.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import { type Position } from "./MinecraftTypes.ts";
import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { type NBT } from "../protocol/nbt.ts";

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
    name: string;
    blockstate: BlockState;
    block: BlockDefinition;
  };
}
