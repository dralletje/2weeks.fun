import { type ChunkData_v1 } from "./World.ts";

export abstract class WorldGenerator {
  seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }

  abstract generate_chunk(x: number, z: number): ChunkData_v1;
}
