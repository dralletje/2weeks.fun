import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { BasicPlayer } from "../BasicPlayer.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import { hex_to_uint8array } from "../utils/hex-x-uint8array.ts";
import { PlayPackets } from "../minecraft-protocol.ts";

// @ts-ignore
import level_chunk_with_light_flat_hex from "./data/level_chunk_with_light_flat.hex" with { type: "text" };
import { sumBy } from "lodash-es";
import { pack_bits_in_longs } from "../utils/pack-longs.ts";

let level_chunk_with_light_flat_bytes = hex_to_uint8array(
  level_chunk_with_light_flat_hex
);

let with_length = encode_with_varint_length(level_chunk_with_light_flat_bytes);
let level_chunk_with_light_2 =
  PlayPackets.clientbound.level_chunk_with_light.read(with_length);

type ChunkData = Array<Array<Array<number>>>;
export class ChunkWorld {
  chunk: ChunkData;
  loaded_chunks = new Set<{ x: number; z: number }>();

  constructor(chunk: ChunkData) {
    this.chunk = chunk;
  }

  load_chunk() {}

  set_block(position: { x: number; y: number; z: number }, block: number) {
    this.chunk[position.x][position.y][position.z] = block;
  }

  packet_for(x: number, z: number) {
    let chunk_blocks = this.chunk.flat().flat();
    let chunk_to_send = {
      ...level_chunk_with_light_2,
      data: [
        {
          non_air_count: sumBy(chunk_blocks, (x) => (x === 0 ? 0 : 1)),
          blocks: {
            type: "direct" as const,
            value: {
              data: pack_bits_in_longs(chunk_blocks, 15),
            },
          },
          biome: level_chunk_with_light_2.data[0].biome,
        },
        ...level_chunk_with_light_2.data.slice(1),
      ],
    };

    return PlayPackets.clientbound.level_chunk_with_light.write({
      ...chunk_to_send,
      chunk_x: x,
      chunk_z: z,
      heightmap: new Uint8Array([0x0a, 0x00]),
    });
  }
}
