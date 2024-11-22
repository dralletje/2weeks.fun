import { BasicPlayer } from "../BasicPlayer.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import { type Position } from "./MinecraftTypes.ts";

export abstract class World {
  players = new MapStateSignal<bigint, BasicPlayer>();
  abstract set_block(options: {
    position: Position;
    block: number;
    transaction_id: number;
  }): void;
  abstract set_blocks(options: {
    blocks: Array<{
      position: { x: number; y: number; z: number };
      blockstate: number;
    }>;
    transaction_id: number;
  }): void;
}
