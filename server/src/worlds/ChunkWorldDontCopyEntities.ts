import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { BasicPlayer } from "./BasicPlayer.ts";
import { hex_to_uint8array } from "./utils/hex-x-uint8array.ts";
import { PlayPackets } from "./protocol/minecraft-protocol.ts";
import { Record } from "@dral/records-and-tuples";
import { range, sumBy } from "lodash-es";
import { pack_bits_in_longs } from "./utils/pack-longs/pack-longs.ts";
import { MinecraftPlaySocket } from "./MinecraftPlaySocket.ts";
import { type AnySignal, effectWithSignal } from "./signals.ts";
import { modulo_cycle } from "./utils/modulo_cycle.ts";
import { type Entity } from "./Drivers/entities_driver.ts";
import {
  find_inside_registry,
  type RegistryResourceKey,
} from "@2weeks/minecraft-data/registries";

// @ts-ignore
import level_chunk_with_light_flat_hex from "./data/level_chunk_with_light_flat.hex" with { type: "text" };
import { type ListedPlayer } from "./PluginInfrastructure/Plugin_v1.ts";
import { Signal } from "signal-polyfill";
import { MapStateSignal } from "./packages/MapStateSignal.ts";
import { ServerWorld_v1, World } from "./PluginInfrastructure/World.ts";
import {
  type ChunkPosition,
  type Position,
} from "./PluginInfrastructure/MinecraftTypes.ts";

import { DatabaseSync } from "node:sqlite";
import {
  type BlockDefinition,
  blocks,
  type BlockState,
} from "@2weeks/minecraft-data";
import { type NBT } from "./protocol/nbt.ts";

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

let chunks_around_chunk = (chunk: Record<ChunkPosition>, radius: number) => {
  let expected_chunks = new Set<{ x: number; z: number }>();
  for (let x of range(-radius, radius + 1)) {
    for (let z of range(-radius, radius + 1)) {
      expected_chunks.add(
        Record({ x: chunk.chunk_x + x, z: chunk.chunk_z + z })
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

export class ChunkWorldDontCopyEntities implements ServerWorld_v1 {
  database: DatabaseSync;
  // chunk: ChunkData;
  copied_entities = new Map<any, bigint>();
  players = new MapStateSignal<bigint, BasicPlayer>();

  connections = new Map<
    bigint,
    { player: BasicPlayer; socket: MinecraftPlaySocket }
  >();

  bottom = 0;
  top = 16;

  public() {
    return this;
  }

  constructor(database: DatabaseSync) {
    this.database = database;

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        x INTEGER,
        y INTEGER,
        z INTEGER,
        blockstate INTEGER,
        PRIMARY KEY (x, y, z)
      )
    `);
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

    let _chunks_currently_loaded = new Set<{ x: number; z: number }>();
    effectWithSignal(signal, async () => {
      let chunk = chunk$.get();
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

      _chunks_currently_loaded = new Set(expected_chunks);

      minecraft_socket.send(
        PlayPackets.clientbound.set_chunk_cache_center.write(chunk)
      );

      let block_entities = this.database
        .prepare(
          `
            SELECT x, y, z, type, data FROM block_entity_v2
            WHERE x BETWEEN 0 AND 15
            AND z BETWEEN 0 AND 15
            AND y BETWEEN 0 AND 15
            ORDER BY y, z, x
          `
        )
        .all() as Array<{
        x: number;
        y: number;
        z: number;
        type: string;
        data: string;
      }>;

      for (let { x, z } of chunks_to_load) {
        minecraft_socket.send(this.packet_for(x, z));

        for (let block_entity of block_entities) {
          minecraft_socket.send(
            PlayPackets.clientbound.block_entity_data.write({
              location: {
                x: block_entity.x + x * 16,
                y: block_entity.y,
                z: block_entity.z + z * 16,
              },
              type: find_inside_registry(
                "minecraft:block_entity_type",
                block_entity.type as any
              ).protocol_id,
              nbt: JSON.parse(block_entity.data) as NBT,
            })
          );
        }
      }
      for (let { x, z } of chunks_to_unload) {
        minecraft_socket.send(
          PlayPackets.clientbound.forget_level_chunk.write({
            chunk_x: x,
            chunk_z: z,
          })
        );
      }
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
    let in_chunk = position_to_in_chunk(position);

    // if (block_entity != null) {
    //   console.log(`block_entity.type:`, block_entity.type);
    //   console.log(
    //     `block_entity.data:`,
    //     JSON.stringify(block_entity.data, null, 2)
    //   );
    //   console.log(
    //     `find_inside_registry`,
    //     find_inside_registry("minecraft:block_entity_type", block_entity.type)
    //       .protocol_id
    //   );
    // }

    for (let { player, socket } of this.connections.values()) {
      let loaded_chunks = chunks_around_chunk(
        position_to_chunk(player.position),
        player.view_distance + 2
      );
      for (let loaded_chunk of loaded_chunks) {
        socket.send(
          PlayPackets.clientbound.block_update.write({
            location: {
              x: in_chunk.x + loaded_chunk.x * 16,
              y: in_chunk.y,
              z: in_chunk.z + loaded_chunk.z * 16,
            },
            block: block,
          })
        );

        if (block_entity != null) {
          socket.send(
            PlayPackets.clientbound.block_entity_data.write({
              location: {
                x: in_chunk.x + loaded_chunk.x * 16,
                y: in_chunk.y,
                z: in_chunk.z + loaded_chunk.z * 16,
              },
              type: find_inside_registry(
                "minecraft:block_entity_type",
                block_entity.type
              ).protocol_id,
              nbt: block_entity.data,
            })
          );
        }
      }

      if (transaction_id != null) {
        socket.send(
          PlayPackets.clientbound.block_changed_ack.write({
            sequence_id: transaction_id,
          })
        );
      }
    }

    let set_block_statement = this.database.prepare(`
      INSERT INTO blocks (x, y, z, blockstate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(x, y, z) DO UPDATE SET blockstate = ?  
    `);
    let set_block_entity = this.database.prepare(`
      INSERT INTO block_entity_v2 (x, y, z, type, data)
      VALUES (?, ?, ?, ?, json(?))
      ON CONFLICT(x, y, z) DO UPDATE SET type = ?, data = json(?)
    `);
    let remove_block_entity_statement = this.database.prepare(`
      DELETE FROM block_entity_v2
      WHERE x = ?
      AND y = ?
      AND z = ?
    `);

    // this.chunk[in_chunk.y][in_chunk.z][in_chunk.x] = block;
    set_block_statement.run(in_chunk.x, in_chunk.y, in_chunk.z, block, block);
    if (block_entity != null) {
      set_block_entity.run(
        in_chunk.x,
        in_chunk.y,
        in_chunk.z,
        block_entity.type,
        JSON.stringify(block_entity.data),
        block_entity.type,
        JSON.stringify(block_entity.data)
      );
    } else {
      remove_block_entity_statement.run(in_chunk.x, in_chunk.y, in_chunk.z);
    }
  }

  set_blocks({
    blocks,
    transaction_id,
  }: {
    blocks: Array<{ position: Position; blockstate: number }>;
    transaction_id?: number | null;
  }) {
    let in_chunk = new Map<{ x: number; y: number; z: number }, number>();
    for (let { position, blockstate } of blocks) {
      if (position.y > 15) continue;

      let location_in_chunk = Record({
        x: modulo_cycle(position.x, 16),
        y: modulo_cycle(position.y, 16),
        z: modulo_cycle(position.z, 16),
      });
      in_chunk.set(location_in_chunk, blockstate);
    }

    let blocks_for_packet = Array.from(in_chunk).map(
      ([position, blockstate]) => {
        return {
          position: position,
          block: blockstate,
        };
      }
    );

    for (let { player, socket } of this.connections.values()) {
      let loaded_chunks = chunks_around_chunk(
        position_to_chunk(player.position),
        player.view_distance + 2
      );

      for (let { x, z } of loaded_chunks) {
        socket.send(
          PlayPackets.clientbound.section_blocks_update.write({
            chunk: { x, y: 0, z },
            blocks: blocks_for_packet,
          })
        );

        // socket.send(
        //   PlayPackets.clientbound.block_changed_ack.write({
        //     sequence_id: transaction_id,
        //   })
        // );
      }
    }

    let set_block_statement = this.database.prepare(`
      INSERT INTO blocks (x, y, z, blockstate)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(x, y, z) DO UPDATE SET blockstate = ?  
    `);
    let remove_block_entity_statement = this.database.prepare(`
      DELETE FROM block_entity_v2
      WHERE x = ?
      AND y = ?
      AND z = ?
    `);

    for (let [position, blockstate] of in_chunk) {
      // this.chunk[position.y][modulo_cycle(position.z, 16)][
      //   modulo_cycle(position.x, 16)
      // ] = blockstate;

      set_block_statement.run(
        position.x,
        position.y,
        position.z,
        blockstate,
        blockstate
      );
      remove_block_entity_statement.run(position.x, position.y, position.z);
    }
  }

  packet_for(x: number, z: number) {
    // let chunk_blocks = this.chunk.flat().flat();

    let chunk_blocks_ = this.database
      .prepare(
        `
      SELECT * FROM blocks
      WHERE x BETWEEN 0 AND 15
      AND z BETWEEN 0 AND 15
      AND y BETWEEN 0 AND 15
      ORDER BY y, z, x
    `
      )
      .all() as Array<{
      x: number;
      y: number;
      z: number;
      blockstate: number;
    }>;

    // let block_entities = this.database
    //   .prepare(
    //     `
    //   SELECT x, y, z, type, data FROM block_entity_v2
    //   WHERE x BETWEEN 0 AND 15
    //   AND z BETWEEN 0 AND 15
    //   AND y BETWEEN 0 AND 15
    //   ORDER BY y, z, x
    // `
    //   )
    //   .all() as Array<{
    //   x: number;
    //   y: number;
    //   z: number;
    //   type: string;
    //   data: string;
    // }>;

    // .all(x * 16, x * 16 + 15, z * 16, z * 16 + 15)

    // console.log(`chunk_blocks_:`, chunk_blocks_);

    let chunk_blocks = chunk_blocks_.map((x) => x.blockstate);

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
      ...level_chunk_with_light_2,

      // chunk_x: 0,
      // chunk_z: 0,
      // heightmap: new Uint8Array([0x0a, 0x00]),

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

    return PlayPackets.clientbound.level_chunk_with_light.write({
      ...chunk_to_send,
      chunk_x: x,
      chunk_z: z,
      heightmap: new Uint8Array([0x0a, 0x00]),
    });
  }

  get_block({ position }: { position: Position }) {
    let in_chunk = position_to_in_chunk(position);
    let get_block_statement = this.database.prepare(`
      SELECT blockstate FROM blocks
      WHERE x = ?
      AND y = ?
      AND z = ?
    `);
    let result = get_block_statement.get(in_chunk.x, in_chunk.y, in_chunk.z) as
      | { blockstate: number }
      | undefined;
    if (result === undefined) {
      return {
        name: "minecraft:air",
        block: blocks["minecraft:air"],
        blockstate: blocks["minecraft:air"].states[0],
      };
    }

    for (let [name, block_definition] of Object.entries(blocks)) {
      let state = block_definition.states.find(
        (x) => x.id === result.blockstate
      );
      if (state != null) {
        return {
          name: name,
          blockstate: state,
          block: block_definition,
        };
      }
    }

    throw new Error(`No block with id ${result.blockstate}`);
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
