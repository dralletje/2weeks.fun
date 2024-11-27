import { range } from "lodash-es";
import { WorldGenerator } from "../PluginInfrastructure/WorldGenerator.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { type ChunkData_v1 } from "../PluginInfrastructure/World.ts";
import { blocks, require_block_by_properties } from "@2weeks/minecraft-data";

let AIR = require_block_by_properties(blocks["minecraft:air"], {});
let GRASS = require_block_by_properties(blocks["minecraft:grass_block"], {});
let DIRT = require_block_by_properties(blocks["minecraft:dirt"], {});
let STONE_BRICKS = require_block_by_properties(
  blocks["minecraft:stone_bricks"],
  {}
);
let BEDROCK = require_block_by_properties(blocks["minecraft:bedrock"], {});

export class PlotsGenerator16 extends WorldGenerator {
  generate_chunk(chunk_x: number, chunk_z: number): ChunkData_v1 {
    let blocks = range(0, 16).map((y) =>
      range(0, 16).map((inchunk_z) =>
        range(0, 16).map((inchunk_x) => {
          let plot_x = modulo_cycle(chunk_x * 16 + inchunk_x, 64);
          let plot_z = modulo_cycle(chunk_z * 16 + inchunk_z, 64);

          // console.log(`plot_x:`, plot_x);
          // console.log(`plot_z:`, plot_z);
          if (y < 5) {
            if (
              plot_x === 0 ||
              plot_x === 63 ||
              plot_z === 0 ||
              plot_z === 63
            ) {
              return { state: STONE_BRICKS.id };
            }
          }

          if (y === 0) {
            return { state: BEDROCK.id };
          } else if (y === 1 || y === 2) {
            return { state: DIRT.id };
          } else if (y === 3) {
            return { state: GRASS.id };
          } else {
            return { state: AIR.id };
          }
        })
      )
    );
    return {
      position: { chunk_x: chunk_x, chunk_z: chunk_z },
      blocks: blocks.flat(2),
    };
  }
}
