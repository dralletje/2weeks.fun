import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { type TextComponent } from "../protocol/text-component.ts";
import { type Vec3 } from "../utils/vec3.ts";

export type Gamemode = "survival" | "creative" | "adventure" | "spectator";

export type Position = {
  x: number;
  y: number;
  z: number;
};

export type ChunkPosition = {
  chunk_x: number;
  chunk_z: number;
};

export type ChunkSectionPosition = {
  chunk: ChunkPosition;
  y: number;
};

export type EntityPosition = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type CardinalDirection = "north" | "south" | "east" | "west";

export type CardinalDirectionWithHalf =
  | CardinalDirection
  | "northwest"
  | "northeast"
  | "southwest"
  | "southeast";

export type Face = "bottom" | "top" | "north" | "south" | "west" | "east";

export let FACES: { [key in Face]: Vec3 } = {
  bottom: { x: 0, y: -1, z: 0 },
  top: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
};

export type Slot = {
  item: RegistryResourceKey<"minecraft:item">;
  count?: number;

  properties?: {
    custom_data?: any;
    rarity?: "common" | "uncommon" | "rare" | "epic";
    lore?: Array<TextComponent | string>;
    max_damage?: number;
    damage?: number;
    item_name?: TextComponent | string;
    custom_name?: TextComponent | string;
    map_id?: number;
    enchantment_glint_override?: boolean;
    custom_model_data?: number;
    max_stack_size?: number;
    unbreakable?: boolean;

    profile?: {
      name?: string;
      uuid?: string;
      properties?: Array<{
        name: string;
        value: string;
        signature?: string;
      }>;
    };
  };
  // nbt: string;
};
