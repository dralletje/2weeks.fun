/// Minecraft specific (should it be in utils/ then?)

import { Record } from "@dral/records-and-tuples";
import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";
import { range } from "lodash-es";

type ChunkPosition = Record<{
  chunk_x: number;
  chunk_z: number;
}>;

export let position_to_chunk = (position: Position): ChunkPosition => {
  let chunk_x = Math.floor(position.x / 16);
  let chunk_z = Math.floor(position.z / 16);
  return Record({ chunk_x: chunk_x, chunk_z: chunk_z });
};

export let chunks_around_chunk = (chunk: ChunkPosition, radius: number) => {
  let expected_chunks = new Set<ChunkPosition>();
  for (let x of range(-radius, radius + 1)) {
    for (let z of range(-radius, radius + 1)) {
      expected_chunks.add(
        Record({ chunk_x: chunk.chunk_x + x, chunk_z: chunk.chunk_z + z })
      );
    }
  }
  return expected_chunks;
};

export let chunkposition = {
  from_position: position_to_chunk,
  length: (chunk: ChunkPosition) => {
    return Math.sqrt(chunk.chunk_x ** 2 + chunk.chunk_z ** 2);
  },
  length2: (chunk: ChunkPosition) => {
    return chunk.chunk_x ** 2 + chunk.chunk_z ** 2;
  },
  subtract: (a: ChunkPosition, b: ChunkPosition) => {
    return {
      x: a.chunk_x - b.chunk_x,
      z: a.chunk_z - b.chunk_z,
    };
  },
};
