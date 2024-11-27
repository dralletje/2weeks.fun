import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { BasicPlayer } from "./BasicPlayer.ts";
import { hex_to_uint8array } from "./utils/hex-x-uint8array.ts";
import { PlayPackets } from "./protocol/minecraft-protocol.ts";
import { Record } from "@dral/records-and-tuples";
import { range, sortBy, sumBy } from "lodash-es";
import { pack_bits_in_longs } from "./utils/pack-longs/pack-longs.ts";
import { MinecraftPlaySocket } from "./MinecraftPlaySocket.ts";
import { effectWithSignal, NotificationSignal } from "./signals.ts";
import { modulo_cycle } from "./utils/modulo_cycle.ts";
import {
  find_inside_registry,
  type RegistryResourceKey,
} from "@2weeks/minecraft-data/registries";
import { Signal } from "signal-polyfill";
import { MapStateSignal } from "./packages/MapStateSignal.ts";
import {
  type ChunkData_v1,
  ServerWorld_v1,
  World,
} from "./PluginInfrastructure/World.ts";
import { type Position } from "./PluginInfrastructure/MinecraftTypes.ts";
import { DatabaseSync } from "node:sqlite";
import { blocks } from "@2weeks/minecraft-data";
import { type NBT } from "./protocol/nbt.ts";
import { vec3 } from "./utils/vec3.ts";
import { WorldGenerator } from "./PluginInfrastructure/WorldGenerator.ts";

// @ts-ignore
import level_chunk_with_light_flat_hex from "./data/level_chunk_with_light_flat.hex" with { type: "text" };

let level_chunk_with_light_flat_bytes = hex_to_uint8array(
  level_chunk_with_light_flat_hex
);

let with_length = encode_with_varint_length(level_chunk_with_light_flat_bytes);
let level_chunk_with_light_2 =
  PlayPackets.clientbound.level_chunk_with_light.read(with_length);

let position_to_chunk = (position: Position): Record<ChunkPosition> => {
  let chunk_x = Math.floor(position.x / 16);
  let chunk_z = Math.floor(position.z / 16);
  return Record({ chunk_x: chunk_x, chunk_z: chunk_z });
};

type ChunkPosition = {
  chunk_x: number;
  chunk_z: number;
};

let chunks_around_chunk = (chunk: ChunkPosition, radius: number) => {
  let expected_chunks = new Set<Record<ChunkPosition>>();
  for (let x of range(-radius, radius + 1)) {
    for (let z of range(-radius, radius + 1)) {
      expected_chunks.add(
        Record({ chunk_x: chunk.chunk_x + x, chunk_z: chunk.chunk_z + z })
      );
    }
  }
  return expected_chunks;
};

let position_to_in_chunk = (position: Position) => {
  return {
    x: modulo_cycle(position.x, 16),
    y: position.y,
    z: modulo_cycle(position.z, 16),
  };
};

let chunk_position = {
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

let chunk_data_to_packet = (chunk: ChunkData_v1) => {
  let chunk_blocks = chunk.blocks.map((x) => x.state);

  let level_height = 16;
  let sections = level_height / 16;
  let light_sections = sections + 2;

  let light_mask = range(1, light_sections).map(() => false);
  light_mask[1] = true;
  // light_mask[2] = true;

  // let empty_block_light_mask = range(1, light_sections).map(() => false);
  // empty_block_light_mask[0] = true;
  // empty_block_light_mask[1] = true;
  // empty_block_light_mask[2] = true;

  let empty_block_light_mask = range(1, light_sections).map(() => false);

  // let g = bitset(light_mask);
  // console.log(`g:`, g);
  // console.log(
  //   `level_chunk_with_light_2:`,
  //   level_chunk_with_light_2["Sky Light Mask"]
  // );

  // console.log(`block_entities:`, block_entities);

  let chunk_to_send = {
    chunk_x: chunk.position.chunk_x,
    chunk_z: chunk.position.chunk_z,
    heightmap: new Uint8Array([0x0a, 0x00]),

    /// Something going wrong with sending the block entities still
    // block_entities: block_entities.map((block_entity) => ({
    //   position_in_chunk: {
    //     x: block_entity.x,
    //     y: block_entity.y,
    //     z: block_entity.z,
    //   },
    //   type: find_inside_registry(
    //     "minecraft:block_entity_type",
    //     block_entity.type as any
    //   ).protocol_id,
    //   nbt: JSON.parse(block_entity.data) as NBT,
    // })),
    block_entities: [],

    "Empty Sky Light Mask": bitset(empty_block_light_mask),
    "Sky Light Mask": bitset(light_mask),
    "Sky Light Arrays": [new Uint8Array(2048).fill(255)],
    // "Sky Light Mask": new Uint8Array([]),

    "Block Light Mask": bitset(empty_block_light_mask),
    "Block Light arrays": [],
    "Empty Block Light Mask": bitset(empty_block_light_mask),

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
    ],
  } satisfies ReturnType<
    typeof PlayPackets.clientbound.level_chunk_with_light.read
  >;

  return PlayPackets.clientbound.level_chunk_with_light.write(chunk_to_send);
};

export class MemoryWorld implements ServerWorld_v1 {
  generator: WorldGenerator;

  players = new MapStateSignal<bigint, BasicPlayer>();
  connections = new Map<
    bigint,
    { player: BasicPlayer; socket: MinecraftPlaySocket }
  >();

  bottom = 0;
  top = 16;

  chunks = new Map<Record<ChunkPosition>, ChunkData_v1>();

  public() {
    return this;
  }

  constructor(generator: WorldGenerator) {
    this.generator = generator;
  }
  map_drivers<Drivers>(drivers: Drivers): Drivers {
    return drivers;
  }

  join({
    player,
    socket,
    signal,
  }: {
    player: BasicPlayer;
    socket: MinecraftPlaySocket;
    signal: AbortSignal;
  }) {
    let minecraft_socket = socket;
    let uuid = player.uuid.toBigInt();
    this.connections.set(uuid, { player, socket });
    this.players.add(uuid, player);

    signal.addEventListener("abort", () => {
      this.players.delete(uuid);
      this.connections.delete(uuid);
    });

    let chunk$ = new Signal.Computed(() => {
      return position_to_chunk(player.position);
    });
    let loaded_chunks$ = new Signal.Computed(() => {
      return chunks_around_chunk(chunk$.get(), player.view_distance + 2);
    });

    let _chunk_currently_generating = false;
    let _chunks_currently_loaded = new Set<Record<ChunkPosition>>();

    let resync$ = new NotificationSignal();

    effectWithSignal(signal, () => {
      resync$.get();

      let chunk_player_is_in = chunk$.get();
      let expected_chunks = loaded_chunks$.get();

      /// Until we have proper Set methods...
      let chunks_to_unload = new Set(_chunks_currently_loaded);
      for (let chunk of expected_chunks) {
        chunks_to_unload.delete(chunk);
      }
      let chunks_to_load = new Set(expected_chunks);
      for (let chunk of _chunks_currently_loaded) {
        chunks_to_load.delete(chunk);
      }

      let chunks_to_load_sorted = sortBy(Array.from(chunks_to_load), (x) =>
        chunk_position.length2(x)
      );

      minecraft_socket.send(
        PlayPackets.clientbound.set_chunk_cache_center.write(chunk_player_is_in)
      );

      for (let chunk of chunks_to_load_sorted) {
        if (!this.chunks.has(chunk)) {
          let generated_chunk = this.generator.generate_chunk(
            chunk.chunk_x,
            chunk.chunk_z
          );
          if (generated_chunk.blocks.length !== 4096) {
            throw new Error(
              `Generated chunk is not 4096 blocks (${generated_chunk.blocks.length})`
            );
          }
          this.chunks.set(chunk, generated_chunk);
        }

        let packet = chunk_data_to_packet(this.chunks.get(chunk)!);
        minecraft_socket.send(packet);
        _chunks_currently_loaded.add(chunk);

        // for (let block_entity of block_entities) {
        //   minecraft_socket.send(
        //     PlayPackets.clientbound.block_entity_data.write({
        //       location: {
        //         x: block_entity.x + x * 16,
        //         y: block_entity.y,
        //         z: block_entity.z + z * 16,
        //       },
        //       type: find_inside_registry(
        //         "minecraft:block_entity_type",
        //         block_entity.type as any
        //       ).protocol_id,
        //       nbt: JSON.parse(block_entity.data) as NBT,
        //     })
        //   );
        // }
      }
      for (let chunk_position of chunks_to_unload) {
        console.log("Unloading:", chunk_position);
        minecraft_socket.send(
          PlayPackets.clientbound.forget_level_chunk.write(chunk_position)
        );
        _chunks_currently_loaded.delete(chunk_position);
      }
      console.log(`_chunks_currently_loaded:`, _chunks_currently_loaded);
    });
  }

  set_block({
    position,
    block,
    block_entity,
    transaction_id,
  }: {
    position: { x: number; y: number; z: number };
    block: number;
    block_entity?: {
      type: RegistryResourceKey<"minecraft:block_entity_type">;
      data: NBT;
    };
    transaction_id?: number;
  }) {
    let chunk = position_to_chunk(position);

    for (let { player, socket } of this.connections.values()) {
      // TODO Check if player has chunk loaded

      socket.send(
        PlayPackets.clientbound.block_update.write({
          location: position,
          block: block,
        })
      );

      if (block_entity != null) {
        socket.send(
          PlayPackets.clientbound.block_entity_data.write({
            location: position,
            type: find_inside_registry(
              "minecraft:block_entity_type",
              block_entity.type
            ).protocol_id,
            nbt: block_entity.data,
          })
        );
      }

      if (transaction_id != null) {
        socket.send(
          PlayPackets.clientbound.block_changed_ack.write({
            sequence_id: transaction_id,
          })
        );
      }
    }

    this.chunks.get(chunk)!.blocks[
      position.y * 16 * 16 + position.z * 16 + position.x
    ] = {
      state: block,
      entity: block_entity,
    };
  }

  set_blocks({
    blocks,
    transaction_id,
  }: {
    blocks: Array<{ position: Position; blockstate: number }>;
    transaction_id?: number | null;
  }) {
    let chunks = new Map<
      Record<ChunkPosition>,
      Array<{ position_in_chunk: Position; blockstate: number }>
    >();
    for (let block of blocks) {
      let chunk = position_to_chunk(block.position);
      if (!chunks.has(chunk)) {
        chunks.set(chunk, []);
      }
      chunks.get(chunk)!.push({
        position_in_chunk: position_to_in_chunk(block.position),
        blockstate: block.blockstate,
      });
    }

    for (let [chunk, blocks] of chunks) {
      if (!this.chunks.has(chunk)) {
        /// TODO What does minecraft do in this case?
        throw new Error(`Chunk not loaded: ${chunk}`);
      }

      for (let { player, socket } of this.connections.values()) {
        socket.send(
          PlayPackets.clientbound.section_blocks_update.write({
            chunk: { x: chunk.chunk_x, y: 0, z: chunk.chunk_z },
            blocks: blocks.map(({ position_in_chunk, blockstate }) => ({
              // position: vec3.add(position, {
              //   x: -(chunk.chunk_x * 16),
              //   y: 0,
              //   z: -(chunk.chunk_z * 16),
              // }),
              position: position_in_chunk,
              block: blockstate,
            })),
          })
        );
      }
    }

    for (let { position, blockstate } of blocks) {
      let in_chunk = position_to_in_chunk(position);
      this.chunks.get(position_to_chunk(position))!.blocks[
        in_chunk.y * 16 * 16 + in_chunk.z * 16 + in_chunk.x
      ] = {
        state: blockstate,
      };
    }
  }

  get_block({ position }: { position: Position }) {
    if (position.y >= this.top || position.y < this.bottom) {
      return {
        name: "minecraft:air",
        blockstate: { id: 0 },
        block: blocks["minecraft:air"],
      };
    }

    let chunk = position_to_chunk(position);
    if (!this.chunks.has(chunk)) {
      throw new Error(`Chunk not loaded: ${chunk.chunk_x}, ${chunk.chunk_z}`);
    }

    let in_chunk = position_to_in_chunk(position);
    let block =
      this.chunks.get(chunk)!.blocks[
        in_chunk.y * 16 * 16 + in_chunk.z * 16 + in_chunk.x
      ];
    if (block == null) {
      throw new Error(
        `Block not loaded: ${position.x}, ${position.y}, ${position.z} (${in_chunk.x}, ${in_chunk.y}, ${in_chunk.z})`
      );
    }

    for (let [name, block_definition] of Object.entries(blocks)) {
      let state = block_definition.states.find((x) => x.id === block.state);
      if (state != null) {
        return {
          name: name,
          blockstate: state,
          block: block_definition,
        };
      }
    }

    throw new Error(`No block with id ${block.state}`);
  }
}

let bitset = (array: Array<boolean>) => {
  let bytes = Math.ceil(array.length / 8);
  let longs = Math.ceil(bytes / 8);
  let actual_bytes = longs * 8;

  let buffer = new Uint8Array(actual_bytes);
  for (let i = 0; i < array.length; i++) {
    if (array[i] === true) {
      buffer[Math.floor(i / 8)] |= 1 << i % 8;
    } else {
      buffer[Math.floor(i / 8)] &= ~(1 << i % 8);
    }
  }
  return buffer.reverse();
};
