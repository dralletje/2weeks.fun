import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { BasicPlayer } from "./BasicPlayer.ts";
import { hex_to_uint8array } from "./utils/hex-x-uint8array.ts";
import { PlayPackets } from "./protocol/minecraft-protocol.ts";
import { Record } from "@dral/records-and-tuples";
import { isEqual, range, sumBy } from "lodash-es";
import { pack_bits_in_longs } from "./utils/pack-longs/pack-longs.ts";
import { MinecraftPlaySocket } from "./MinecraftPlaySocket.ts";
import { type AnySignal, effectWithSignal } from "./signals.ts";
import { modulo_cycle } from "./utils/modulo_cycle.ts";
import { entity_uuid_counter, type Entity } from "./Drivers/entities_driver.ts";

// @ts-ignore
import level_chunk_with_light_flat_hex from "./data/level_chunk_with_light_flat.hex" with { type: "text" };
import { emplace } from "./packages/immappable.ts";
import { compositeKey } from "./packages/compositeKeys.ts";
import { type ListedPlayer } from "./PluginInfrastructure/Plugin_v1.ts";
import { Signal } from "signal-polyfill";
import { MapStateSignal } from "./packages/MapStateSignal.ts";
import { World } from "./PluginInfrastructure/World.ts";
import { type Position } from "./PluginInfrastructure/MinecraftTypes.ts";
import { blocks } from "@2weeks/minecraft-data";

let level_chunk_with_light_flat_bytes = hex_to_uint8array(
  level_chunk_with_light_flat_hex
);

let with_length = encode_with_varint_length(level_chunk_with_light_flat_bytes);
let level_chunk_with_light_2 =
  PlayPackets.clientbound.level_chunk_with_light.read(with_length);

let position_to_chunk = (position: Position) => {
  let chunk_x = Math.floor(position.x / 16);
  let chunk_z = Math.floor(position.z / 16);
  return Record({ x: chunk_x, z: chunk_z });
};

let chunks_around_chunk = (chunk: Position, radius: number) => {
  let expected_chunks = new Set<{ x: number; z: number }>();
  for (let x of range(-radius, radius + 1)) {
    for (let z of range(-radius, radius + 1)) {
      expected_chunks.add(Record({ x: chunk.x + x, z: chunk.z + z }));
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

type ChunkData = Array<Array<Array<number>>>;
export class ChunkWorld implements World {
  chunk: ChunkData;
  copied_entities = new Map<any, bigint>();
  players = new MapStateSignal<bigint, BasicPlayer>();

  bottom = 0;
  top = 0;

  connections = new Map<
    bigint,
    { player: BasicPlayer; socket: MinecraftPlaySocket }
  >();

  constructor(chunk: ChunkData) {
    if (chunk.length !== 16) {
      throw new Error("Chunk must be 16x16x16");
    }
    if (chunk.some((x) => x.length !== 16)) {
      throw new Error("Chunk must be 16x16x16");
    }
    if (chunk.some((x) => x.some((y) => y.length !== 16))) {
      throw new Error("Chunk must be 16x16x16");
    }

    this.chunk = chunk;
  }

  get_block({ position }: { position: { x: number; y: number; z: number } }) {
    let in_chunk = position_to_in_chunk(position);
    let result = this.chunk[in_chunk.y][in_chunk.z][in_chunk.x];

    if (result === undefined) {
      return {
        name: "minecraft:air",
        block: blocks["minecraft:air"],
        blockstate: blocks["minecraft:air"].states[0],
      };
    }

    for (let [name, block_definition] of Object.entries(blocks)) {
      let state = block_definition.states.find((x) => x.id === result);
      if (state != null) {
        return {
          name: name,
          blockstate: state,
          block: block_definition,
        };
      }
    }

    throw new Error(`No block with id ${result}`);
  }

  map_drivers(
    player: BasicPlayer,
    {
      entities$,
      playerlist$,
    }: {
      entities$: AnySignal<Array<Map<bigint, Entity>>>;
      playerlist$: AnySignal<Array<Map<bigint, ListedPlayer>>>;
    }
  ): {
    entities$: AnySignal<Array<Map<bigint, Entity>>>;
    playerlist$: AnySignal<Array<Map<bigint, ListedPlayer>>>;
  } {
    let chunk_where_player_is$ = new Signal.Computed(() => {
      return position_to_chunk(player.position);
    });
    let loaded_chunks$ = new Signal.Computed(() => {
      return chunks_around_chunk(
        chunk_where_player_is$.get(),
        player.view_distance + 2
      );
    });

    let uuids_to_copy$ = new Signal.Computed(
      () => {
        return Array.from(entities$.get()).flatMap((entities) => {
          return Array.from(entities.keys());
        });
      },
      { equals: isEqual }
    );

    let copied_uuids$ = new Signal.Computed(
      (): Map<bigint, Array<{ x: number; z: number; uuid: bigint }>> => {
        let chunks = loaded_chunks$.get();
        let chunk_where_player_is = chunk_where_player_is$.get();
        let uuids_to_copy = uuids_to_copy$.get();

        return new Map(
          uuids_to_copy.map((uuid) => {
            return [
              uuid,
              Array.from(chunks)
                // .filter((x) => x !== chunk_where_player_is)
                .map((chunk) => {
                  let key = compositeKey(player, uuid, chunk);
                  let new_uuid = emplace(this.copied_entities, key, {
                    insert: () => entity_uuid_counter.get_id(),
                  });

                  return {
                    x: chunk.x,
                    z: chunk.z,
                    uuid: new_uuid,
                  };
                }),
            ];
          })
        );
      }
    );

    let player_copies$ = new Signal.Computed(
      () => {
        let chunk_where_player_is = chunk_where_player_is$.get();
        return Array.from(loaded_chunks$.get())
          .filter((x) => x !== chunk_where_player_is)
          .map((chunk): { uuid: bigint; chunk: { x: number; z: number } } => {
            let chunk_relative = Record({
              x: chunk.x - chunk_where_player_is.x,
              z: chunk.z - chunk_where_player_is.z,
            });
            let key = compositeKey(player, chunk_relative);
            let new_uuid = emplace(this.copied_entities, key, {
              insert: () => entity_uuid_counter.get_id(),
            });
            return { uuid: new_uuid, chunk: chunk };
          });
      },
      { equals: isEqual }
    );

    let player_copies_entities$ = new Signal.Computed(() => {
      let player_copies = player_copies$.get();
      return new Map(
        player_copies.map(({ chunk, uuid }): [bigint, Entity] => {
          let relative = position_to_in_chunk(player.position);

          return [
            uuid,
            {
              type: "minecraft:player",
              position: {
                x: relative.x + chunk.x * 16,
                y: relative.y,
                z: relative.z + chunk.z * 16,
              },
              pitch: player.position.pitch,
              yaw: player.position.yaw,
              head_yaw: player.position.yaw * (256 / 360),
              data: 0,
              velocity_x: 0,
              velocity_y: 0,
              velocity_z: 0,
              equipment: {},
              metadata_raw: new Map([
                // [2, { type: "optional_chat", value: "Hi" }],
                // [3, { type: "boolean", value: true }],
                // [4, { type: "boolean", value: false }],
                // [6, { type: "pose", value: "swimming" }],
              ]),
            },
          ];
        })
      );
    });

    // return {
    //   entities$: entities$,
    //   playerlist$: playerlist$,
    // };

    let _playerlist$ = new Signal.Computed(() => {
      let copied_uuids = copied_uuids$.get();
      let player_copies = player_copies$.get();
      return [
        new Map(
          player_copies.map(({ uuid }) => {
            return [
              uuid,
              {
                display_name: null,
                game_mode: "creative",
                listed: false,
                name: player.name,
                ping: 0,
                properties:
                  player.texture ?
                    [
                      {
                        name: "textures",
                        value: player.texture.value,
                        signature: player.texture.signature,
                      },
                    ]
                  : [],
              },
            ] as [bigint, ListedPlayer];
          })
        ),
        ...playerlist$.get().map((playerlist) => {
          return new Map(
            Array.from(playerlist).flatMap(([uuid, listedplayer]) => {
              if (!copied_uuids.has(uuid)) {
                return [[uuid, listedplayer] as [bigint, ListedPlayer]];
              } else {
                return copied_uuids.get(uuid)!.map(({ x, z, uuid }) => {
                  let listedplayer_new: ListedPlayer = {
                    ...listedplayer,
                    listed: false,
                  };
                  return [uuid, listedplayer_new] as [bigint, ListedPlayer];
                });
              }
            })
          );
        }),
      ];
    });

    return {
      // entities$: entities$,
      entities$: new Signal.Computed(() => {
        let copied_uuids = copied_uuids$.get();
        return [
          // ...entities$.get(),
          player_copies_entities$.get(),
          ...entities$.get().map((entities) => {
            return new Map(
              Array.from(entities).flatMap(([uuid, entity]) => {
                if (!copied_uuids.has(uuid)) {
                  return [[uuid, entity]];
                } else {
                  return copied_uuids.get(uuid)!.map(({ x, z, uuid }) => {
                    return [
                      uuid,
                      {
                        ...entity,
                        position: {
                          y: entity.position.y,
                          x: modulo_cycle(entity.position.x, 16) + x * 16,
                          z: modulo_cycle(entity.position.z, 16) + z * 16,
                        },
                      },
                    ];
                  });
                }
              })
            );
          }),
        ];
      }),
      playerlist$: new Signal.Computed(() => {
        return [...playerlist$.get(), ..._playerlist$.get()];
        // return _playerlist$.get();
      }),
    };
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

      console.log(`chunk:`, chunk);
      minecraft_socket.send(
        PlayPackets.clientbound.set_chunk_cache_center.write({
          chunk_x: chunk.x,
          chunk_z: chunk.z,
        })
      );

      for (let { x, z } of chunks_to_load) {
        minecraft_socket.send(this.packet_for(x, z));
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
    transaction_id,
  }: {
    position: { x: number; y: number; z: number };
    block: number;
    transaction_id: number;
  }) {
    let in_chunk = position_to_in_chunk(position);
    this.chunk[in_chunk.y][in_chunk.z][in_chunk.x] = block;

    for (let { player, socket } of this.connections.values()) {
      socket.send(
        PlayPackets.clientbound.block_update.write({
          location: {
            x: in_chunk.x,
            y: in_chunk.y,
            z: in_chunk.z,
          },
          block: block,
        })
      );

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
      }

      socket.send(
        PlayPackets.clientbound.block_changed_ack.write({
          sequence_id: transaction_id,
        })
      );
    }
  }

  set_blocks({
    blocks,
    transaction_id,
  }: {
    blocks: Array<{ position: Position; blockstate: number }>;
    transaction_id?: number | null;
  }) {
    /// This would be good code for a non-chunky world
    // let by_chunk = new Map<
    //   { x: number; z: number },
    //   Array<{ position: Position; blockstate: number }>
    // >();
    // for (let { position, blockstate } of blocks) {
    //   let chunk = position_to_chunk(position);
    //   let blocks = emplace(by_chunk, chunk, { insert: () => [] });
    //   blocks.push({ position, blockstate });
    // }

    // for (let { player, socket } of this.connections.values()) {
    //   let loaded_chunks = chunks_around_chunk(
    //     position_to_chunk(player.position),
    //     player.view_distance + 2
    //   );

    //   for (let [{ x, z }, blocks] of by_chunk) {
    //     let blocks_for_packet = blocks.map(({ position, blockstate }) => {
    //       let in_chunk = {
    //         x: position.x - x * 16,
    //         y: modulo_cycle(position.y, 16),
    //         z: position.z - z * 16,
    //       };
    //       return {
    //         position: in_chunk,
    //         block: blockstate,
    //       };
    //     })

    //     for (let loaded_chunk of loaded_chunks) {
    //       socket.send(
    //         PlayPackets.clientbound.section_blocks_update.write({
    //           chunk: { x, y: -4, z },
    //           blocks: blocks_for_packet,
    //         })
    //       );
    //     }

    //     // socket.send(
    //     //   PlayPackets.clientbound.block_changed_ack.write({
    //     //     sequence_id: transaction_id,
    //     //   })
    //     // );
    //   }
    // }

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

    for (let [position, blockstate] of in_chunk) {
      this.chunk[position.y][modulo_cycle(position.z, 16)][
        modulo_cycle(position.x, 16)
      ] = blockstate;
    }
  }

  packet_for(x: number, z: number) {
    // let pppp = {
    //   encode: (values: Array<bigint>) => {
    //     let buffer = new ArrayBuffer(values.length * 8);
    //     let dataview = new DataView(buffer);
    //     for (let i = 0; i < values.length; i++) {
    //       dataview.setBigInt64(i * 8, values[i]);
    //     }
    //     return new Uint8Array(buffer);
    //   },
    //   decode: (buffer: Uint8Array) => {
    //     let longs = new BigInt64Array(buffer.buffer);
    //     return [Array.from(longs), buffer.length];
    //     // return native.repeated(mcp.varint, mcp.Long).decode(buffer);
    //   },
    // } satisfies Protocol<Array<bigint>>;

    let chunk_blocks = this.chunk.flat().flat();

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

    let chunk_to_send = {
      ...level_chunk_with_light_2,

      // chunk_x: 0,
      // chunk_z: 0,
      // heightmap: new Uint8Array([0x0a, 0x00]),

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
        // ...level_chunk_with_light_2.data.slice(1),
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
