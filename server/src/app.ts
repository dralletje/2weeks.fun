import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import {
  blocks,
  find_inside_registry_id,
  find_packet_name,
  packets,
  registries,
} from "@2weeks/minecraft-data/src/minecraft-data.ts";
import { type App } from "@2weeks/tcp-workers";
import { Record } from "@bloomberg/record-tuple-polyfill";
import chalk from "chalk";
import {
  chunk,
  differenceBy,
  floor,
  isEqual,
  mapValues,
  range,
  sumBy,
  uniq,
  zip,
} from "lodash-es";
import { Signal } from "signal-polyfill";
import { parse as parse_uuid } from "uuid";
import { emplace, immutable_emplace } from "./immappable.ts";
import {
  ConfigurationPackets,
  HandshakePackets,
  LoginPackets,
  PlayPackets,
  StatusPackets,
} from "./minecraft-protocol.ts";
import { Mojang } from "./packages/Mojang.ts";
import { SingleEventEmitter } from "./packages/single-event-emitter.ts";
import {
  type Bossbar,
  bossbars_synchronizer,
} from "./player-synchronizers/bossbars.ts";
import {
  entities_synchronizer,
  type Entity,
} from "./player-synchronizers/entities.ts";
import { bytes, combined, native } from "./protocol.ts";
import { effect } from "./signals.ts";
import {
  entity_id_counter,
  entity_uuid_counter,
  NumberCounter,
} from "./Unique.ts";
import { WithVarintLengthTransformStream } from "./WithVarintLengthTransformStream.ts";
import { mcp } from "./mcp.ts";

// @ts-ignore
import level_chunk_with_light_flat_hex from "../data/level_chunk_with_light_flat.hex" with { type: "text" };
// @ts-ignore
import buffer_of_0x07s from "../data/buffer_of_0x07s.bin" with { type: "binary" };
import { type TextComponent } from "./protocol/text-component.ts";
import { flatten_command_node } from "./protocol/brigadier.ts";
import brigadier from "./commands/brigradier.ts";
import tp_plugin from "./commands/tp.ts";

let start_interval = (
  callback: () => void,
  options: { interval: number; signal: AbortSignal }
) => {
  let interval = setInterval(callback, options.interval * 1000);
  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      clearInterval(interval);
    });
  }
};

type DuplexStream<Read = Uint8Array, Write = Uint8Array> = {
  readable: ReadableStream<Read>;
  writable: WritableStream<Write>;
};

let hex_to_uint8array = (hex: string) => {
  let clustered = chunk(hex.replaceAll(/[^0-9A-Fa-f]/g, ""), 2);
  let bytes = clustered.map((byte) => parseInt(byte.join(""), 16));
  return new Uint8Array(bytes);
};
let uint8array_as_hex = (buffer: Uint8Array) => {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
};

let read_required = async <T>(reader: ReadableStreamDefaultReader<T>) => {
  let { value, done } = await reader.read();
  if (done || !value) {
    throw new Error(`Connection closed`);
  }
  return value;
};

let read_single = async (readable_stream: ReadableStream<Uint8Array>) => {
  let reader = readable_stream.getReader();
  let { value, done } = await reader.read();
  reader.releaseLock();
  if (done || !value) {
    throw new Error(`Connection closed`);
  }
  return value;
};

let state_configuration = async ({
  socket: { readable, writable },
}: {
  socket: DuplexStream;
}) => {
  let writer = writable.getWriter();
  try {
    await writer.write(
      ConfigurationPackets.clientbound.select_known_packs.write({
        packs: [{ namespace: "minecraft", id: "core", version: "1.21.1" }],
      })
    );

    await writer.write(
      ConfigurationPackets.clientbound.server_links.write({
        links: [
          {
            label: { true: "Bug Report" },
            url: "https://bugs.mojang.com",
          },
        ],
      })
    );

    for await (let packet of readable.values({ preventCancel: true })) {
      let [{ packet_id }] = packet_id_protocol.decode(packet);

      if (
        packet_id === ConfigurationPackets.serverbound.client_information.id
      ) {
        let stuff =
          ConfigurationPackets.serverbound.client_information.read(packet);
        console.log(
          chalk.magenta(`[CONFIGURATION]`),
          chalk.gray(`CLIENT_INFORMATION:`),
          stuff
        );
        /// Also ignoring!
      } else if (
        packet_id === ConfigurationPackets.serverbound.custom_payload.id
      ) {
        let { channel, data } =
          ConfigurationPackets.serverbound.custom_payload.read(packet);
        console.log(
          chalk.magenta(`[CONFIGURATION]`),
          chalk.gray(`PLUGIN_MESSAGE:`),
          channel
        );
        /// Ignoring!
      } else if (
        packet_id === ConfigurationPackets.serverbound.finish_configuration.id
      ) {
        let _ =
          ConfigurationPackets.serverbound.finish_configuration.read(packet);
        console.log(
          chalk.magenta(`[CONFIGURATION]`),
          chalk.gray(`ACKNOWLEDGE_FINISH_CONFIGURATION`)
        );
        return;
      } else if (
        packet_id === ConfigurationPackets.serverbound.select_known_packs.id
      ) {
        let _ =
          ConfigurationPackets.serverbound.select_known_packs.read(packet);

        /// The default configuration packets which I got from the Notchian server
        await writer.write(buffer_of_0x07s);

        await writer.write(
          ConfigurationPackets.clientbound.finish_configuration.write({})
        );
      } else {
        console.log(`[CONFIGURATION] UNKNOWN PACKET:`, packet_id);
      }
    }

    throw new Error("Connection closed in configuration");
  } finally {
    writer.releaseLock();
  }
};

// try {
//   let with_packet_length = native.with_byte_length(
//     mcp.varint,
//     native.uint8array
//   );
//   let offset = 0;
//   while (true) {
//     let [packet_1, length_1] = with_packet_length.decode(
//       buffer_of_0x07s.subarray(offset)
//     );
//     let b = ConfigurationPackets.clientbound.registry_data.read(
//       with_packet_length.encode(packet_1)
//     );
//     offset += length_1;
//     console.log(`b:`, b);
//   }
// } catch (error) {}

let level_chunk_with_light_flat_bytes = hex_to_uint8array(
  level_chunk_with_light_flat_hex
);

//////////////////////////////////////////////////

let ASSUME_HEIGHT = 384;
let ASSUME_SECTIONS = ASSUME_HEIGHT / 16;

let with_length = encode_with_varint_length(level_chunk_with_light_flat_bytes);
let level_chunk_with_light_2 =
  PlayPackets.clientbound.level_chunk_with_light.read(with_length);

let my_chunk = range(0, 16).map((y) =>
  range(0, 16).map((z) =>
    range(0, 16).map((x): number => {
      if (y < 4) {
        if (x === 0 || x === 15 || z === 0 || z === 15) {
          return 79;
        }
      }

      if (y === 0) {
        return 79;
      } else if (y === 1 || y === 2) {
        return 10;
      } else if (y === 3) {
        return 9;
      } else {
        return 0;
      }
    })
  )
);

let pack_bits_in_longs = (entry: Array<number>, bits_per_entry: number) => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let chunks = chunk(entry, entries_per_long);

  let longs = chunks.map((chunk) => {
    let long = 0n;
    /// Not reeeaaallly sure why this is reversed...
    /// BUT IT WORKS!
    for (let bit of chunk.toReversed()) {
      long = (long << BigInt(bits_per_entry)) | BigInt(bit);
    }
    return long;
  });
  return longs;
};

let unpack_bits_from_longs = (longs: Array<bigint>, bits_per_entry: number) => {
  let entries_per_long = Math.floor(64 / bits_per_entry);
  let entries = longs.flatMap((long) => {
    let entry: Array<number> = [];
    for (let i of range(0, entries_per_long)) {
      entry.push(Number(long & ((1n << BigInt(bits_per_entry)) - 1n)));
      long >>= BigInt(bits_per_entry);
    }
    return entry;
  });
  return entries;
};

// let _chunk_blocks = my_chunk.flat().flat();

// let chunkdata: Parameters<
//   typeof PlayPackets.clientbound.level_chunk_with_light.write
// >[0] = {
//   // "Block Light Mask": new Uint8Array([]),
//   // "Empty Block Light Mask": new Uint8Array([]),
//   // "Sky Light Mask": new Uint8Array([]),
//   // "Empty Sky Light Mask": new Uint8Array([]),
//   // "Block Light arrays": [],
//   // "Sky Light Arrays": [],

//   // block_entities: [],
//   // chunk_x: 0,
//   // chunk_z: 0,
//   // heightmap: new Uint8Array([]),
//   ...level_chunk_with_light_2,
//   data: [
//     {
//       non_air_count: sumBy(_chunk_blocks, (x) => (x === 0 ? 0 : 1)),
//       // blocks: {
//       //   type: "indirect",
//       //   value: {
//       //     pallete: [79, 10, 9, 0],
//       //     data: pack_bits_in_longs(
//       //       blocks.map((x) => [79, 10, 9, 0].indexOf(x)),
//       //       4
//       //     ),
//       //   },
//       // },
//       blocks: {
//         type: "direct" as const,
//         value: {
//           data: pack_bits_in_longs(_chunk_blocks, 15),
//         },
//       },

//       biome: level_chunk_with_light_2.data[0].biome,
//     },
//     ...level_chunk_with_light_2.data.slice(1),

//     // ...level_chunk_with_light_2.data,

//     // ...range(1, 16).map((y) => ({
//     //   non_air_count: 0,
//     //   blocks: {
//     //     prefix: 0,
//     //     data: {
//     //       pallete: 0,
//     //       data: [],
//     //     },
//     //   },
//     //   biome: level_chunk_with_light_2.data[0].biome,
//     // })),
//   ],
// };

// let chunkbunk = PlayPackets.clientbound.level_chunk_with_light.write(chunkdata);

// console.log(
//   `isEqual(level_chunk_with_light_2, chunkbunk):`,
//   isEqual(with_length, chunkbunk)
// );

// let p = PlayPackets.clientbound.level_chunk_with_light.read(with_length);
// let b = PlayPackets.clientbound.level_chunk_with_light.write(p);

// console.log(`isEqual(chunkdata, p):`, isEqual(chunkdata, p));
// console.log(`isEqual(with_length, b):`, isEqual(with_length, b));

let Faces = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

let async = async (async) => async();

type PacketsToListeners<
  Packets extends { [key: string]: { protocol_id: number } },
> = {
  [K in keyof Packets]: SingleEventEmitter<Uint8Array>;
};

class MinecraftPlaySocket {
  on_packet: PacketsToListeners<typeof packets.play.serverbound> = mapValues(
    packets.play.serverbound,
    () => new SingleEventEmitter<Uint8Array>()
  );

  constructor(socket: DuplexStream) {
    // let { readable, writable } = socket;
    // let reader = readable.pipeThrough(WithVarintLengthTransformStream()).getReader();
    // let writer = writable.getWriter();
  }
}

class ProcessV1 {
  constructor(
    fn: (options: { signal: AbortSignal }) => void,
    { signal }: { signal: AbortSignal }
  ) {
    fn({ signal: signal });
  }
}

let interval_iterator = async function* (
  interval: number,
  { signal }: { signal: AbortSignal }
) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (signal.aborted) {
      return;
    }
    yield;
  }
};

let error = (message: string) => {
  throw new Error(message);
};

let teleport_ids = new NumberCounter();

let chat_stream = new SingleEventEmitter<{
  message: string;
  sender: { uuid: bigint; name: string };
}>();
let broadcast_stream = new SingleEventEmitter<{
  message: TextComponent;
}>();

type Position = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};
type Slot = {
  item: string;
  count: number;
  rarity?: "common" | "uncommon" | "rare" | "epic";
  lore?: Array<string>;
  // nbt: string;
};
type Hotbar = [
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
];
let players_persistence = new Map<
  bigint,
  { hotbar: Hotbar; position: Position; last_login: Date }
>();

// let definitions = uniq(Object.entries(blocks).map((x) => x[1].definition.type));
// console.log(`definitions:`, definitions);

let state_PLAY = async ({
  socket: { readable, writable },
  uuid,
  username,
  texture,
}: {
  socket: DuplexStream;
  uuid: bigint;
  username: string;
  texture: string | null;
}) => {
  let minecraft_socket = new MinecraftPlaySocket({ readable, writable });

  let player_from_persistence = emplace(players_persistence, uuid, {
    insert: () => ({
      hotbar: [null, null, null, null, null, null, null, null, null] as Hotbar,
      position: { x: 0, y: -58, z: 0, yaw: 0, pitch: 0 },
      last_login: new Date(),
    }),
    update: (player) => ({
      ...player,
      last_login: new Date(),
    }),
  });

  console.log(chalk.blue("[PLAY]"), "Entering PLAY state");
  let writer = writable.getWriter();
  let server_closed_controller = new AbortController();
  try {
    let server_closed_signal = server_closed_controller.signal;
    let closed_signal = server_closed_controller.signal;

    let player_entity_id = entity_id_counter.get_id();

    await writer.write(
      PlayPackets.clientbound.login.write({
        dimension: { name: "minecraft:overworld", type: 0 },
        dimensions: [
          "minecraft:overworld",
          "minecraft:the_end",
          "minecraft:the_nether",
        ],
        enable_respawn_screen: true,
        entity_id: player_entity_id,
        game_mode: "creative",
        hashed_seed: 5840439894700503850n,
        is_debug_world: false,
        is_flat_world: true,
        is_hardcore: false,
        reduced_debug_info: false,
        secure_chat: false,
        simulation_distance: 20,
        view_distance: 3,
        has_death_location: false,
        limited_crafting: false,
        max_players: 20,
        portal_cooldown: 0,
        previous_game_mode: 0,
      })
    );
    await writer.write(
      PlayPackets.clientbound.game_event.write({
        event: { type: "start_raining" },
      })
    );
    await writer.write(
      // PlayPackets.clientbound.game_event.write({ event_id: 0x07, data: 0 })
      PlayPackets.clientbound.game_event.write({
        event: { type: "rain_level_change", value: 0 },
      })
    );
    await writer.write(
      // PlayPackets.clientbound.game_event.write({ event_id: 0x08, data: 0 })
      PlayPackets.clientbound.game_event.write({
        event: { type: "thunder_level_change", value: 0 },
      })
    );
    await writer.write(
      // PlayPackets.clientbound.game_event.write({ event_id: 0x0d, data: 0 })
      PlayPackets.clientbound.game_event.write({
        event: { type: "start_waiting_for_level_chunks" },
      })
    );

    console.log(chalk.blue("[PLAY]"), "Sent login packet");

    let nudge_event = new SingleEventEmitter<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
    }>();
    let nudge_in_progress$ = new Signal.State(null as { id: number } | null);
    nudge_event.on(
      (move) => {
        console.log("START NUDGE");
        let teleport_id = teleport_ids.get_id();
        nudge_in_progress$.set({ id: teleport_id });
        position$.set(move);
        writer.write(
          PlayPackets.clientbound.player_position.write({
            x: move.x,
            y: move.y,
            z: move.z,
            yaw: move.yaw,
            pitch: move.pitch,
            teleport_id: teleport_id,
          })
        );
      },
      { signal: server_closed_signal }
    );

    let position$ = new Signal.State(
      {
        ...player_from_persistence.position,
        /// Move player up 1 when joining
        y: player_from_persistence.position.y + 1,
      },
      {
        equals: isEqual,
      }
    );
    let movement$ = new Signal.State(0);
    new ProcessV1(
      ({ signal }) => {
        minecraft_socket.on_packet["minecraft:accept_teleportation"].on(
          (packet) => {
            let { teleport_id } =
              PlayPackets.serverbound.accept_teleportation.read(packet);
            if (nudge_in_progress$.get()?.id === teleport_id) {
              nudge_in_progress$.set(null);
            }
          },
          { signal: signal }
        );

        minecraft_socket.on_packet["minecraft:move_player_pos"].on(
          (packet) => {
            let { x, y, z, ground } =
              PlayPackets.serverbound.move_player_pos.read(packet);
            let position = position$.get();

            if (nudge_in_progress$.get() != null) {
              return;
            }

            position$.set({
              x,
              y,
              z,
              yaw: position$.get().yaw,
              pitch: position$.get().pitch,
            });

            movement$.set(
              movement$.get() +
                Math.abs(x - position.x) +
                Math.abs(z - position.z) +
                Math.abs(y - position.y)
            );
          },
          { signal: signal }
        );
        minecraft_socket.on_packet["minecraft:move_player_pos_rot"].on(
          (packet) => {
            let { x, feet_y, z, yaw, pitch, ground } =
              PlayPackets.serverbound.move_player_pos_rot.read(packet);
            let position = position$.get();

            if (nudge_in_progress$.get() != null) {
              return;
            }

            position$.set({ x, y: feet_y, z, yaw, pitch });

            movement$.set(
              movement$.get() +
                Math.abs(x - position.x) +
                Math.abs(z - position.z) +
                Math.abs(feet_y - position.y)
            );
          },
          { signal: signal }
        );
        minecraft_socket.on_packet["minecraft:move_player_rot"].on(
          (packet) => {
            let { yaw, pitch, ground } =
              PlayPackets.serverbound.move_player_rot.read(packet);
            // console.log(`yaw, pitch:`, yaw, pitch);
            if (nudge_in_progress$.get() != null) {
              return;
            }

            position$.set({ ...position$.get(), yaw, pitch });
          },
          { signal: signal }
        );
        minecraft_socket.on_packet["minecraft:move_player_status_only"].on(
          (packet) => {
            let { on_ground } =
              PlayPackets.serverbound.move_player_status_only.read(packet);
            // console.log(`on_ground:`, on_ground);
          },
          { signal: signal }
        );
      },
      { signal: server_closed_signal }
    );

    let initial_position = position$.get();
    await writer.write(
      PlayPackets.clientbound.player_position.write({
        x: initial_position.x,
        y: initial_position.y,
        z: initial_position.z,
        yaw: initial_position.yaw,
        pitch: initial_position.pitch,
        teleport_id: 0,
      })
    );

    let accept_teleportation = mcp.Packet(
      packets.play.serverbound["minecraft:accept_teleportation"].protocol_id,
      [{ name: "teleport_id", protocol: mcp.varint }]
    );

    for await (let packet of readable.values({ preventCancel: true })) {
      let [{ packet_id }] = packet_id_protocol.decode(packet);

      if (packet_id === accept_teleportation.id) {
        /// Teleport confirm
        let { teleport_id } = accept_teleportation.read(packet);
        console.log(chalk.green("Teleport confirmed"));
        break;
      } else {
        console.log(
          chalk.blue(`[PLAY]`),
          chalk.red(
            find_packet_name({
              id: packet_id,
              state: "play",
              direction: "serverbound",
            })
          ),
          format_packet_id(packet_id)
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));
      }
    }

    await writer.write(
      PlayPackets.clientbound.player_info_update_BASIC.write({
        players: [
          {
            uuid: uuid,
            actions: {
              name: "Michiel Dral",
              properties: [],
            },
          },
        ],
      })
    );

    chat_stream.on(
      ({ message, sender }) => {
        writer.write(
          PlayPackets.clientbound.player_chat.write({
            header: {
              index: 0,
              sender: sender.uuid,
              signature: null,
            },
            body: {
              message: message,
              salt: 0n,
              timestamp: BigInt(Date.now()),
            },
            previous_messages: [],
            formatting: {
              chat_type: 1,
              sender_name: `§9${sender.name}`,
              target_name: null,
            },
            other: {
              content: `${message}`,
            },
          })
        );
      },
      { signal: server_closed_signal }
    );

    // let chunk_to_send = level_chunk_with_light_2;
    // let chunk_to_send = chunkdata;

    let RANGE = 5;
    let chunk$ = new Signal.Computed(
      () => {
        let position = position$.get();
        let chunk_x = Math.floor(position.x / 16);
        let chunk_z = Math.floor(position.z / 16);
        return { x: chunk_x, z: chunk_z };
      },
      { equals: isEqual }
    );

    let loaded_chunks$ = new Signal.Computed(() => {
      let chunk = chunk$.get();
      let expected_chunks = new Set<Record & { x: number; z: number }>();
      for (let x of range(-RANGE, RANGE + 1)) {
        for (let z of range(-RANGE, RANGE + 1)) {
          expected_chunks.add(Record({ x: chunk.x + x, z: chunk.z + z }));
        }
      }
      return expected_chunks;
    });

    let _chunks_currently_loaded = new Set<Record & { x: number; z: number }>();
    effect(async () => {
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

      await writer.write(
        PlayPackets.clientbound.set_chunk_cache_center.write({
          chunk_x: chunk.x,
          chunk_z: chunk.z,
        })
      );

      let chunk_blocks = my_chunk.flat().flat();
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

      for (let { x, z } of chunks_to_load) {
        await writer.write(
          PlayPackets.clientbound.level_chunk_with_light.write({
            ...chunk_to_send,
            chunk_x: x,
            chunk_z: z,
            heightmap: new Uint8Array([0x0a, 0x00]),
          })
        );
      }
      for (let { x, z } of chunks_to_unload) {
        await writer.write(
          PlayPackets.clientbound.forget_level_chunk.write({
            chunk_x: x,
            chunk_z: z,
          })
        );
      }
    });

    let bossbars$ = new Signal.State<Map<bigint, Bossbar>>(
      new Map([
        [
          0n,
          {
            title: "Starting server...",
            health: 0.05,
            color: "blue",
            division: "20 notches",
            flags: new Set(["create_fog"]),
          },
        ],
      ])
    );
    bossbars_synchronizer({ writer, bossbars$ });
    async(async () => {
      for await (let _ of interval_iterator(300, { signal: closed_signal })) {
        bossbars$.set(
          immutable_emplace(bossbars$.get(), 0n, {
            update: (old) => {
              return {
                ...old,
                health: modulo_cycle(old.health + 0.05, 1),
              };
            },
          })
        );
      }
    });

    let field_of_view_modifier$ = new Signal.State(0.1);
    let flags$ = new Signal.State(
      new Set(["creative_mode", "allow_flying"]) as Set<
        "creative_mode" | "allow_flying" | "invulnerable" | "flying"
      >
    );
    let flying_speed$ = new Signal.State(0.1);

    effect(() => {
      let flags = flags$.get();
      let flying_speed = flying_speed$.get();
      let field_of_view_modifier = field_of_view_modifier$.get();
      writer.write(
        PlayPackets.clientbound.player_abilities.write({
          flags: flags,
          flying_speed: flying_speed,
          field_of_view_modifier: field_of_view_modifier,
        })
      );
    });
    minecraft_socket.on_packet["minecraft:player_abilities"].on(
      (packet) => {
        let { flags } = PlayPackets.serverbound.player_abilities.read(packet);
        let is_flying = flags.has("flying");
        if (is_flying) {
          flags$.set(new Set([...flags$.get(), "flying"]));
        } else {
          flags$.set(new Set([...flags$.get()].filter((x) => x !== "flying")));
        }
      },
      { signal: server_closed_signal }
    );

    let creepy_entities$ = new Signal.State(new Map<bigint, Entity>());

    let modulo_cycle = (n: number, m: number) => {
      return ((n % m) + m) % m;
    };

    await writer.write(
      PlayPackets.clientbound.custom_chat_completions.write({
        action: "set",
        entries: ["@dralletje", "@michieldral", "@hi"],
      })
    );

    minecraft_socket.on_packet["minecraft:chat"].on(
      async (packet) => {
        let chat = PlayPackets.serverbound.chat.read(packet);
        chat_stream.emit({
          message: chat.message,
          sender: {
            uuid: uuid,
            name: "michieldral",
          },
        });
      },
      { signal: server_closed_signal }
    );

    let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
      let position = position$.get();
      return new Map(
        Array.from(creepy_entities$.get()).map(([uuid, entity]) => {
          let entity_height =
            entity.type === "minecraft:enderman"
              ? 2.9
              : entity.type === "minecraft:cat" ||
                  entity.type === "minecraft:allay"
                ? 0.5
                : 1.62;

          /// Pitch from this entity to the player
          let dx = position.x - entity.x;
          let dy = position.y + 1.62 - (entity.y + entity_height);
          let dz = position.z - entity.z;
          let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
          let pitch = Math.asin(dy / distance);
          let yaw = Math.atan2(dx, dz);

          let _pitch = -((pitch / Math.PI) * (256 / 2));
          let yaw2 = modulo_cycle((-yaw / (2 * Math.PI)) * 256, 256);

          return [
            uuid,
            {
              ...entity,
              pitch: _pitch,
              yaw: yaw2,
              head_yaw: yaw2,
            },
          ];
        })
      );
    });

    let statusbar_text$ = new Signal.Computed(() => {
      let position = Array.from(entities$.get().values()).at(-1);

      if (position) {
        return `Yaw: ${floor(position.yaw, 0).toFixed(0).padStart(3, " ")}`;
      }
    });

    entities_synchronizer({ entities$, writer });

    effect(async () => {
      let statusbar_text = statusbar_text$.get();
      if (statusbar_text) {
        await writer.write(
          PlayPackets.clientbound.set_action_bar_text.write({
            text: statusbar_text,
          })
        );
      }
    });

    let compass$ = new Signal.Computed(() => {
      let position = position$.get();
      return {
        x: position.x,
        y: position.y,
        z: position.z - 10000,
      };
    });

    writer.write(
      PlayPackets.clientbound.tab_list.write({
        header: "\n  §7Welcome to the server!  \nAnd more",
        footer: "§7Welcome to the server!",
      })
    );
    writer.write(
      PlayPackets.clientbound.player_info_update.write({
        actions: {
          type: new Set(["add_player", "update_listed"]),
          value: [
            {
              uuid: uuid,
              // @ts-ignore
              actions: {
                add_player: {
                  name: "Michiel Dral",
                  properties: texture
                    ? [
                        {
                          name: "textures",
                          value: texture,
                          signature: null,
                        },
                      ]
                    : [],
                },
                update_listed: true,
              },
            },
          ],
        },
      })
    );

    /// Compass position
    effect(async () => {
      let compass = compass$.get();
      await writer.write(
        PlayPackets.clientbound.set_default_spawn_position.write({
          location: {
            x: compass.x,
            y: compass.y,
            z: compass.z,
          },
          angle: 0,
        })
      );
    });

    let p = tp_plugin();

    minecraft_socket.on_packet["minecraft:chat_command"].on(
      async (packet) => {
        let { command } = PlayPackets.serverbound.chat_command.read(packet);
        console.log(`[PLAY] Chat command: ${command}`);

        if (command.startsWith("tp")) {
          let [, x, y, z] = command.split(" ");
          let move = {
            x: parseFloat(x),
            y: parseFloat(y),
            z: parseFloat(z),
            yaw: 0,
            pitch: 0,
          };
          nudge_event.emit(move);
        } else if (command.startsWith("excalibur")) {
          inventory$.set(
            inventory$.get().toSpliced(1, 1, {
              item: "minecraft:diamond_sword",
              count: 1,
              rarity: "epic",
              lore: ["Excalibur"],
            }) as any
          );
        } else if (command.startsWith("fov")) {
          let [, value] = command.split(" ");

          let new_field_of_view_modifier = parseFloat(value);
          if (!Number.isNaN(new_field_of_view_modifier)) {
            writer.write(
              PlayPackets.clientbound.disguised_chat.write({
                message: `Field of view set to ${new_field_of_view_modifier}`,
                chat_type: 1,
                sender_name: "",
                target_name: null,
              })
            );
            field_of_view_modifier$.set(new_field_of_view_modifier);
          }
        } else if (command.startsWith("summon")) {
          let [, _entity_type] = command.split(" ");
          let entity_id = entity_uuid_counter.get_id();

          let entity_type =
            registries["minecraft:entity_type"].entries[_entity_type] != null
              ? _entity_type
              : // prettier-ignore
                registries["minecraft:entity_type"].entries[`minecraft:${_entity_type}`] != null
                ? `minecraft:${_entity_type}`
                : error(`Unknown entity type: ${_entity_type}`);

          let uuid =
            entity_type === "minecraft:player"
              ? bytes.uint128.decode(
                  parse_uuid("069a79f4-24e9-4726-a5be-fca90e38aaf5")
                )[0]
              : BigInt(entity_id);

          let position = position$.get();

          creepy_entities$.set(
            immutable_emplace(creepy_entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: entity_type,
                x: position.x,
                y: position.y,
                z: position.z,
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,

                equipment: {
                  main_hand: {
                    item: "minecraft:diamond_sword",
                    count: 1,
                    rarity: "epic",
                    lore: ["Excalibur"],
                  },
                },
              }),
            })
          );
        } else {
          await writer.write(
            PlayPackets.clientbound.disguised_chat.write({
              message: `Unknown command: ${command}`,
              chat_type: 1,
              sender_name: "",
              target_name: null,
            })
          );
        }
      },
      { signal: server_closed_signal }
    );

    broadcast_stream.on(
      ({ message }) => {
        let x = PlayPackets.clientbound.system_chat.write({
          message: message,
          is_action_bar: false,
        });
        console.log(`SYSTEM MESSAGE:`, uint8array_as_hex(x));
        writer.write(x);
      },
      { signal: server_closed_signal }
    );

    // broadcast_stream.emit({ message: `§7* §9${username} §7joined the game` });
    broadcast_stream.emit({
      message: {
        text: "§7* §9Michiel Joined!",
        extra: [
          { text: "cool" },
          {
            type: "keybind",
            keybind: "key.swapOffhand",

            color: "red",
            bold: true,
          },
        ],
        // extra: [],
      },
      // message: "Hey there!",
    });

    let time$ = new Signal.State(1n);
    effect(async () => {
      let time = time$.get();
      await writer.write(
        PlayPackets.clientbound.set_time.write({
          world_age: 0n,
          time: -time,
        })
      );
    });

    /// QUICK TIME!
    // async(async () => {
    //   for await (let _ of interval_iterator(10, { signal: closed_signal })) {
    //     time$.set((time$.get() + 10n) % 24000n);
    //   }
    // });

    /// Time based on position!
    // effect(async () => {
    //   let position = position$.get();
    //   time$.set(
    //     BigInt(
    //       Math.floor(
    //         ((Math.abs(position.x) / 16) ** 2 +
    //           (Math.abs(position.z) / 16) ** 2) *
    //           24000
    //       )
    //     )
    //   );
    // });

    /// Time based on movement!
    // let TIME_SPEED = 200;
    // // let TIME_SPEED = 1000
    // effect(async () => {
    //   let movement = movement$.get();
    //   time$.set(BigInt(Math.ceil(movement * TIME_SPEED)) % 24000n);
    // });

    type ResourcepackRequest = {
      uuid: bigint;
      url: string;
      hash: string;
      forced: boolean;
      prompt: string;
      /// TODO way to communicate?
      //status$: Signal.State<"pending" | "accepted" | "declined">;
    };
    let resourcepacks$ = new Signal.State<Array<ResourcepackRequest>>([]);
    let _current_packs: Array<ResourcepackRequest> = [];

    effect(async () => {
      let current_packs = resourcepacks$.get();
      let new_packs = differenceBy(current_packs, _current_packs, "uuid");
      let removed_packs = differenceBy(_current_packs, current_packs, "uuid");

      _current_packs = current_packs;

      for (let pack of new_packs) {
        await writer.write(
          PlayPackets.clientbound.resource_pack_push.write({
            uuid: pack.uuid,
            url: pack.url,
            hash: pack.hash,
            forced: pack.forced,
            prompt: pack.prompt,
          })
        );
      }
      for (let pack of removed_packs) {
        await writer.write(
          PlayPackets.clientbound.resource_pack_pop.write({
            uuid: pack.uuid,
          })
        );
      }
    });
    minecraft_socket.on_packet["minecraft:resource_pack"].on(
      (packet) => {
        let { uuid, status } =
          PlayPackets.serverbound.resource_pack_response.read(packet);
        console.log(`[PLAY] Resource pack response: ${status}`);
      },
      { signal: closed_signal }
    );

    let brigadier_command = brigadier();

    let x = flatten_command_node({
      type: "root",
      children: [
        brigadier_command.nodes,
        {
          type: "argument",
          is_executable: false,
          name: "bar",
          children: [],
          parser: { type: "brigadier:integer" },
        },
      ],
    });

    let commands_packet = PlayPackets.clientbound.commands.write({
      nodes: x.nodes,
      root_index: x.root_index,
    });

    console.log(`x.nodes:`, x.nodes);
    console.log(`commands_packet:`, commands_packet);

    writer.write(commands_packet);

    let inventory$ = new Signal.State(player_from_persistence.hotbar);
    let hotbar_selection$ = new Signal.State(0);

    minecraft_socket.on_packet["minecraft:set_carried_item"].on(
      async (packet) => {
        let { slot } = PlayPackets.serverbound.set_carried_item.read(packet);
        hotbar_selection$.set(slot);
      },
      { signal: closed_signal }
    );
    minecraft_socket.on_packet["minecraft:set_creative_mode_slot"].on(
      (packet) => {
        console.log(
          chalk.blue(`[PLAY]`),
          chalk.magenta(`minecraft:set_creative_mode_slot`)
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));

        let { slot, clicked_item } =
          PlayPackets.serverbound["set_create_mode_slot"].read(packet);
        // inventory[slot] = 1;
        if (clicked_item.type === 0) {
          let hotbar_slot = slot - 36;
          inventory$.set(
            inventory$.get().toSpliced(hotbar_slot, 1, null) as Hotbar
          );
        } else {
          if (clicked_item.type !== 1) {
            throw new Error(`Unknown clicked item count: ${clicked_item.type}`);
          }
          if (!clicked_item.value) {
            throw new Error("No value");
          }
          let item = clicked_item.value;

          let name = find_inside_registry_id(
            registries["minecraft:item"],
            item.item_id
          );

          console.log(
            chalk.blue(`[PLAY]`),
            chalk.red(`minecraft:set_creative_mode_slot`),
            chalk.white(`${slot}`),
            name
          );
          console.log(`filled_slot:`, item.components.value);
          let decode_values = {} as any;
          for (let value of item.components.value.added) {
            if (value.type === "minecraft:lore") {
              // @ts-ignore
              decode_values.lore = value.value.map((x) => x.value);
            } else if (value.type === "minecraft:rarity") {
              decode_values.rarity = value.value;
            } else {
              throw new Error(`Unknown component type: ${value.type}`);
            }
          }

          console.log(chalk.gray(uint8array_as_hex(packet)));

          let hotbar_slot = slot - 36;
          if (hotbar_slot >= 0 && hotbar_slot < 9) {
            inventory$.set(
              inventory$.get().toSpliced(hotbar_slot, 1, {
                item: name,
                count: 1,
                ...decode_values,
              }) as Hotbar
            );
          }
        }
      },
      { signal: server_closed_signal }
    );

    let _player_inventory: Array<Slot | null> = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    effect(async () => {
      let inventory = inventory$.get();
      console.log(`inventory:`, inventory);

      let i = 0;
      for (let [next, prev] of zip(inventory, _player_inventory)) {
        if (isEqual(next, prev)) {
          i += 1;
          continue;
        } else {
          let slot_data =
            next == null || next.count === 0
              ? { type: 0, value: undefined }
              : {
                  type: next.count,
                  value: {
                    item_id:
                      registries["minecraft:item"].entries[next.item]
                        .protocol_id,
                    components: {
                      type: {
                        number_to_add:
                          (next.lore != null ? 1 : 0) +
                          (next.rarity != null ? 1 : 0),
                        number_to_remove: 0,
                      },
                      value: {
                        added: [
                          ...(next.lore != null
                            ? [
                                {
                                  type: "minecraft:lore" as const,
                                  value: next.lore.map((x) => ({
                                    type: "string",
                                    value: x,
                                  })),
                                },
                              ]
                            : []),
                          ...(next.rarity != null
                            ? [
                                {
                                  type: "minecraft:rarity" as const,
                                  value: next.rarity,
                                },
                              ]
                            : []),
                        ],
                        removed: [],
                      },
                    },
                  },
                };
          await writer.write(
            PlayPackets.clientbound.container_set_slot.write({
              window_id: 0,
              slot: 36 + i,
              state_id: 0,
              slot_data: slot_data,
            })
          );
          i += 1;
        }
      }
    });

    let build = new ProcessV1(
      ({ signal }) => {
        minecraft_socket.on_packet["minecraft:player_action"].on(
          async (packet) => {
            let { action, location, face, sequence } =
              PlayPackets.serverbound.player_action.read(packet);

            if (action === "finish_digging") {
              // console.log(
              //   chalk.blue(`[PLAY]`),
              //   chalk.red(`player_action`),
              //   chalk.white(`${status}`),
              //   chalk.yellow(`${face}`),
              //   chalk.green(`${sequence}`)
              // );

              let block_position = {
                x: modulo_cycle(location.x, 16),
                y: location.y,
                z: modulo_cycle(location.z, 16),
              };

              let q = {
                x: block_position.x,
                y: modulo_cycle(block_position.y, 16),
                z: block_position.z,
              };
              my_chunk[q.y][q.z][q.x] = 0;

              await writer.write(
                PlayPackets.clientbound.block_update.write({
                  location: block_position,
                  block: 0,
                })
              );

              for (let loaded_chunk of loaded_chunks$.get()) {
                await writer.write(
                  PlayPackets.clientbound.block_update.write({
                    location: {
                      x: block_position.x + loaded_chunk.x * 16,
                      y: block_position.y,
                      z: block_position.z + loaded_chunk.z * 16,
                    },
                    block: 0,
                  })
                );
              }

              await writer.write(
                PlayPackets.clientbound.block_changed_ack.write({
                  sequence_id: sequence,
                })
              );
            } else if (action === "drop_item") {
            } else {
              console.log(
                chalk.blue(`[PLAY]`),
                chalk.red(`player_action`),
                chalk.white(`${action}`),
                chalk.yellow(`${face}`),
                chalk.green(`${sequence}`)
              );
            }
          },
          { signal }
        );

        minecraft_socket.on_packet["minecraft:use_item_on"].on(
          async (packet) => {
            let {
              cursor_x,
              cursor_y,
              cursor_z,
              face,
              location,
              hand,
              sequence,
            } = PlayPackets.serverbound.use_item_on.read(packet);
            // await writer.write(
            //   PlayPackets.clientbound.set_action_bar_text.write({
            //     text: `Cursor: ${cursor_x},${cursor_y},${cursor_z} Face: ${face} Location: ${location.x},${location.y},${location.z} Hand: ${hand}`,
            //   })
            // );
            let face_vector = Faces[face];

            let inventory = inventory$.get();
            let slot = inventory[hotbar_selection$.get()];

            console.log(`slot:`, slot);

            if (slot) {
              let block = blocks[slot.item];

              if (slot.item === "minecraft:water_bucket") {
                block = blocks["minecraft:water"];
              }

              if (block == null) {
                console.log(
                  chalk.blue(`[PLAY]`),
                  chalk.red(`Unknown block: ${slot.item}`)
                );
                return;
              }

              let block_position = {
                x: modulo_cycle(location.x + face_vector.x, 16),
                y: location.y + face_vector.y,
                z: modulo_cycle(location.z + face_vector.z, 16),
              };

              let player_position = position$.get();
              let p1 = modulo_cycle(floor(player_position.x), 16);
              let p2 = block_position.x;

              if (
                modulo_cycle(floor(player_position.x), 16) ===
                  block_position.x &&
                modulo_cycle(floor(player_position.z), 16) ===
                  block_position.z &&
                floor(player_position.y) === block_position.y
              ) {
                nudge_event.emit({
                  ...player_position,
                  y: player_position.y + 1,
                });

                // position$.set({
                //   ...player_position,
                //   y: player_position.y + 1,
                // });
              }

              let p = {
                x: block_position.x,
                y: modulo_cycle(block_position.y, 16),
                z: block_position.z,
              };
              let state = block.states.find((x) => x.default)?.id ?? 0;
              my_chunk[p.y][p.z][p.x] = state;

              for (let loaded_chunk of loaded_chunks$.get()) {
                await writer.write(
                  PlayPackets.clientbound.block_update.write({
                    location: {
                      x: block_position.x + loaded_chunk.x * 16,
                      y: block_position.y,
                      z: block_position.z + loaded_chunk.z * 16,
                    },
                    block: state,
                  })
                );
              }
              // await writer.write(
              //   PlayPackets.clientbound.block_update.write({
              //     location: {
              //       x: block_position.x,
              //       y: block_position.y,
              //       z: block_position.z,
              //     },
              //     block: state,
              //   })
              // );
              await writer.write(
                PlayPackets.clientbound.block_changed_ack.write({
                  sequence_id: sequence,
                })
              );
            }

            await writer.write(
              PlayPackets.clientbound.disguised_chat.write({
                message: `Block placed!`,
                chat_type: 1,
                sender_name: "",
                target_name: null,
              })
            );
            await writer.write(
              PlayPackets.clientbound.disguised_chat.write({
                message: `  Cursor ${cursor_x.toFixed(2)}, ${cursor_y.toFixed(2)}, ${cursor_z.toFixed(2)}`,
                chat_type: 1,
                sender_name: "",
                target_name: null,
              })
            );
            await writer.write(
              PlayPackets.clientbound.disguised_chat.write({
                message: `  Location ${location.x}, ${location.y}, ${location.z}`,
                chat_type: 1,
                sender_name: "",
                target_name: null,
              })
            );
          },
          { signal }
        );
      },
      { signal: server_closed_signal }
    );

    let keep_alive = new ProcessV1(
      ({ signal }) => {
        let last_keep_alive = BigInt(Date.now());

        start_interval(
          async () => {
            last_keep_alive = BigInt(Date.now());
            await writer.write(
              PlayPackets.clientbound.keep_alive.write({ id: last_keep_alive })
            );
          },
          {
            interval: 5,
            signal: signal,
          }
        );

        minecraft_socket.on_packet["minecraft:keep_alive"].on(
          (packet) => {
            let { id } = PlayPackets.serverbound.keep_alive.read(packet);
            if (id !== last_keep_alive) {
              console.log(`[PLAY] Keep alive mismatch`);
              /// Not yet sure how to close the server but we'll figure it out
              // server_closed_controller.abort();
            }
          },
          { signal: signal }
        );
      },
      { signal: server_closed_signal }
    );

    effect(() => {
      emplace(players_persistence, uuid, {
        update: (x) => {
          return {
            position: position$.get(),
            hotbar: inventory$.get(),
            last_login: x.last_login,
          };
        },
      });
    });

    for await (let packet of readable.values({ preventCancel: true })) {
      let [{ packet_id }] = packet_id_protocol.decode(packet);

      let packet_name = find_packet_name({
        id: packet_id,
        state: "play",
        direction: "serverbound",
      });

      let listener =
        minecraft_socket.on_packet[
          packet_name as "minecraft:accept_teleportation"
        ];

      if (listener.locked === false) {
        console.log(
          chalk.blue(`[PLAY]`),
          chalk.red(
            find_packet_name({
              id: packet_id,
              state: "play",
              direction: "serverbound",
            })
          ),
          format_packet_id(packet_id)
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));
      } else {
        listener.emit(packet);
      }
    }

    throw new Error("Connection closed");
  } finally {
    server_closed_controller.abort();
    writer.releaseLock();
  }
};

let packet_id_protocol = native.with_byte_length(
  mcp.varint,
  combined([
    { name: "packet_id", protocol: mcp.varint },
    { name: "payload", protocol: native.uint8array },
  ])
);

let state_STATUS = async ({
  socket: { readable, writable },
}: {
  socket: DuplexStream;
}) => {
  let writer = writable.getWriter();

  let VERSION = {
    name: "1.21.1",
    protocol: 767,
  };

  for await (let packet of readable) {
    let [{ packet_id }] = packet_id_protocol.decode(packet);

    if (packet_id === StatusPackets.serverbound.status_request.id) {
      /// STATUS
      let _ = StatusPackets.serverbound.status_request.read(packet);
      await writer.write(
        StatusPackets.clientbound.status_response.write({
          response: {
            version: VERSION,
            players: {
              max: 20,
              online: 0,
              sample: [],
            },
            description: "Hello, world!",
          },
        })
      );
    } else if (packet_id === StatusPackets.serverbound.ping_request.id) {
      /// PING
      let { timestamp } = StatusPackets.serverbound.ping_request.read(packet);
      await writer.write(
        StatusPackets.clientbound.pong_response.write({ timestamp })
      );
    }
  }
  writer.close();
};

let format_packet_id = (id: number) => `0x${id.toString(16).padStart(2, "0")}`;

let compact_uuid_to_bigint = (uuid: string) => {
  return BigInt(`0x${uuid}`);
};

export default {
  ports: [25565],
  async connect({ port, socket }, env) {
    let packet_readable = socket.readable.pipeThrough(
      WithVarintLengthTransformStream()
    );

    let reader = packet_readable.getReader();
    let writer = socket.writable.getWriter();

    let handshake = HandshakePackets.serverbound.intention.read(
      await read_required(reader)
    );

    console.log(chalk.bgGreen("  "), chalk.green("Client connecting1"));
    console.log(chalk.bgGreen("  "), chalk.green("host"), handshake.host);
    console.log(chalk.bgGreen("  "), chalk.green("port"), handshake.port);
    console.log(
      chalk.bgGreen("  "),
      chalk.green("next_state"),
      handshake.next_state
    );

    if (handshake.next_state === "status") {
      /// Necessary to switch to async iterator
      reader.releaseLock();
      writer.releaseLock();

      await state_STATUS({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
      });
    } else if (handshake.next_state === "login") {
      let { name, uuid: offline_uuid } = LoginPackets.serverbound.hello.read(
        await read_required(reader)
      );

      let mojang_uuid = await Mojang.get_uuid(name);
      let texture = mojang_uuid ? await Mojang.get_texture(mojang_uuid) : null;

      let uuid = mojang_uuid
        ? compact_uuid_to_bigint(mojang_uuid)
        : offline_uuid;

      await writer.write(
        LoginPackets.clientbound.game_profile.write({
          name: name,
          uuid: uuid,
          properties: texture
            ? [
                {
                  name: "textures",
                  value: texture,
                  signature: null,
                },
              ]
            : [],
        })
      );
      let _ = LoginPackets.serverbound.login_acknowledged.read(
        await read_required(reader)
      );

      reader.releaseLock();
      writer.releaseLock();
      await state_configuration({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
      });
      await state_PLAY({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
        uuid: uuid,
        username: name,
        texture: texture,
      });
    } else if (handshake.next_state === "transfer") {
      throw new Error("Unexpected next_state 3 (transer)");
    } else {
      throw new Error(`Unknown next_state: ${handshake.next_state}`);
    }
  },
} satisfies App;
