import { find_packet_name } from "@2weeks/minecraft-data";
import chalk from "chalk";
import { mapValues, range } from "lodash-es";
import { DatabaseSync } from "node:sqlite";
import { Signal } from "signal-polyfill";
import { v4 } from "uuid";
import {
  BasicPlayer,
  type Hotbar,
  type OnInteractEvent,
  slot_to_packetable,
} from "./BasicPlayer.ts";
import { ChunkWorldDontCopyEntities } from "./ChunkWorldDontCopyEntities.ts";
import { makeBossbarsDriver } from "./Drivers/bossbars_driver.ts";
import { makeChatDriver } from "./Drivers/chat_driver.ts";
import { commands_driver } from "./Drivers/commands_driver.ts";
import {
  entity_id_counter,
  makeEntitiesDriver,
} from "./Drivers/entities_driver.ts";
import { makeInventoryDriver } from "./Drivers/inventory_driver.ts";
import { keepalive_driver } from "./Drivers/keepalive_driver.ts";
import { makePlayerlistDriver } from "./Drivers/playerlist_driver.ts";
import { makePositionDriver } from "./Drivers/position_driver.ts";
import { makeResourcepacksDriver } from "./Drivers/resourcepacks_driver.ts";
import { serverlinks_driver } from "./Drivers/serverlinks_driver.ts";
import { makeSignuiDriver } from "./Drivers/signui_driver.ts";
import { makeWindowsV1Driver } from "./Drivers/windows_v1_driver.ts";
import { mcp } from "./protocol/mcp.ts";
import { PlayPackets } from "./protocol/minecraft-protocol.ts";
import {
  type DuplexStream,
  MinecraftPlaySocket,
} from "./MinecraftPlaySocket.ts";
import { LockableEventEmitter } from "./packages/lockable-event-emitter.ts";
import { SingleEventEmitter } from "./packages/single-event-emitter.ts";
import { StoppableHookableEventController } from "./packages/stopable-hookable-event.ts";
import { type Driver_v1 } from "./PluginInfrastructure/Driver_v1.ts";
import {
  type Slot,
  type EntityPosition,
} from "./PluginInfrastructure/MinecraftTypes.ts";
import {
  type Plugin_v1,
  type Plugin_v1_Args,
} from "./PluginInfrastructure/Plugin_v1.ts";
import { plugins } from "./plugins.ts";
import {
  combined,
  concat,
  native,
  type Protocol,
} from "./protocol/protocol.ts";
import { type TextComponent } from "./protocol/text-component.ts";
import { type AnySignal, effectWithSignal } from "./signals.ts";
import { uint8array_as_hex } from "./utils/hex-x-uint8array.ts";
import { UUID } from "./utils/UUID.ts";
import { SwitchSignalController } from "./utils/SwitchSignal.ts";
import { makePlayerstateDriver } from "./Drivers/playerstate_driver.ts";

let database = new DatabaseSync("world.sqlite3");

database.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    x INT,
    y INT,
    z INT,
    blockstate INT,
    PRIMARY KEY (x, y, z)
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS block_entity_v2 (
    x INT,
    y INT,
    z INT,
    type TEXT,
    data TEXT,
    PRIMARY KEY (x, y, z)
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS players (
    uuid TEXT PRIMARY KEY,
    document TEXT
  )
`);

let blocks2 = database.prepare(`SELECT * FROM blocks LIMIT 1`).all();
if (blocks2.length === 0) {
  let blocks = range(0, 16).map((y) =>
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
  let insert_block = database.prepare(`
    INSERT INTO blocks (x, y, z, blockstate)
    VALUES (?, ?, ?, ?)
  `);

  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        insert_block.run(x, y, z, blocks[y][z][x]);
      }
    }
  }
}

let my_chunk_world = new ChunkWorldDontCopyEntities(database);

let async = async (async) => async();

class ProcessV1 {
  constructor(
    fn: (options: { signal: AbortSignal }) => void,
    { signal }: { signal: AbortSignal }
  ) {
    async(async () => {
      try {
        fn({ signal: signal });
      } catch (error) {
        console.log(`error:`, error);
      }
    });
  }
}

let error = (message: string) => {
  throw new Error(message);
};

// let chat_stream = new SingleEventEmitter<{
//   message: string;
//   sender: { uuid: bigint; name: string };
// }>();
let broadcast_stream = new SingleEventEmitter<{
  message: TextComponent | string;
}>();

let format_packet_id = (id: number) => `0x${id.toString(16).padStart(2, "0")}`;

// let world = new World();
let world = my_chunk_world;

let combine_sinks = <T, Out>(
  plugins$: Signal.State<Array<T>>,
  on: (plugin: T) => AnySignal<Out> | undefined | null
) => {
  return new Signal.Computed(() => {
    return plugins$
      .get()
      .map((plugin) => on(plugin))
      .filter((sink$) => sink$ != null)
      .map((sink$) => sink$.get());
  });
};

type PlayerPersistence = {
  inventory: {
    slots: Array<Slot | null>;
    selected_slot: number;
  };
  position: EntityPosition;
  last_login: Date;
};

let get_player_from_persistence = (uuid: UUID): PlayerPersistence => {
  let user = database
    .prepare(
      `
    SELECT document
    FROM players
    WHERE uuid = ?
  `
    )
    .get(uuid.toString()) as { document: string } | undefined;

  return {
    inventory: {
      slots: Array(46).fill(null),
      selected_slot: 0,
      ...(user != null ? JSON.parse(user.document).inventory : {}),
    },
    position: { x: 0, y: 6, z: 0, yaw: 0, pitch: 0 },
    last_login: new Date(),
    ...(user != null ? JSON.parse(user.document) : {}),
  };
};

let set_player_to_persistence = (uuid: UUID, player: PlayerPersistence) => {
  database
    .prepare(
      `
    INSERT OR REPLACE INTO players (uuid, document)
    VALUES (?, ?)
  `
    )
    .run(uuid.toString(), JSON.stringify(player));
};

export class MutableSurvivalInventory {
  inventory$: Signal.State<{
    slots: Array<Slot | null>;
    selected_slot: number;
  }>;

  constructor({
    initial_data,
  }: {
    initial_data: {
      slots: Array<Slot | null>;
      selected_slot: number;
    };
  }) {
    this.inventory$ = new Signal.State(initial_data);
  }

  set_slot(slot: number, item: Slot | null) {
    this.inventory$.set({
      slots: this.inventory$.get().slots.toSpliced(slot, 1, item),
      selected_slot: this.inventory$.get().selected_slot,
    });
  }
  set_hotbar_slot(slot: number, item: Slot | null) {
    this.inventory$.set({
      ...this.inventory$.get(),
      slots: this.inventory$.get().slots.toSpliced(slot + 36, 1, item),
    });
  }

  get hotbar() {
    return this.inventory$.get().slots.slice(36, 45);
  }
  get selected_hotbar_slot() {
    return this.inventory$.get().selected_slot;
  }
  get item_holding() {
    return this.hotbar[this.selected_hotbar_slot];
  }

  on_set_create_mode_slot(slot: number, item: Slot | null) {
    this.set_slot(slot, item);
  }
  on_set_carried_item(slot: number) {
    if (slot < 0 || slot >= 9) {
      throw new Error(`Invalid hotbar slot: ${slot}`);
    }
    this.inventory$.set({
      slots: this.inventory$.get().slots,
      selected_slot: slot,
    });
  }
}

export let play = async ({
  socket: { readable, writable },
  uuid,
  username,
  texture,
}: {
  socket: DuplexStream;
  uuid: UUID;
  username: string;
  texture: { value: string; signature: string } | null;
}) => {
  let server_closed_controller = new AbortController();
  let signal = server_closed_controller.signal;
  let writer = writable.getWriter();
  let effect_for_drivers = (fn) => effectWithSignal(signal, fn);
  let minecraft_socket = new MinecraftPlaySocket({ writer: writer });

  let player_from_persistence = get_player_from_persistence(uuid);

  let server_broadcast_stream = new LockableEventEmitter<{
    message: TextComponent | string;
  }>();
  let chat_stream = new LockableEventEmitter<{
    message: TextComponent | string;
    sender: { uuid: bigint; name: string };
  }>();

  console.log(`${chalk.blue("[PLAY]")} ${chalk.blue("Entering PLAY state")}`);
  try {
    let player_entity_id = entity_id_counter.get_id();

    let view_distance$ = new Signal.State(3);

    minecraft_socket.send(
      PlayPackets.clientbound.login.write({
        dimension: { name: "dral:chunky", type: 4 },
        dimensions: [
          "minecraft:overworld",
          "minecraft:the_end",
          "minecraft:the_nether",
        ],
        enable_respawn_screen: true,
        entity_id: player_entity_id,
        game_mode: "spectator",
        hashed_seed: 5840439894700503850n,
        is_debug_world: false,
        is_flat_world: true,
        is_hardcore: false,
        reduced_debug_info: false,
        secure_chat: false,
        simulation_distance: 1,
        view_distance: view_distance$.get(),
        has_death_location: false,
        limited_crafting: false,
        max_players: 20,
        portal_cooldown: 0,
        previous_game_mode: 0,
      })
    );

    let survival_inventory = new MutableSurvivalInventory({
      initial_data: player_from_persistence.inventory,
    });

    minecraft_socket.send(
      PlayPackets.clientbound.game_event.write({
        event: { type: "start_waiting_for_level_chunks" },
      })
    );

    let on_interact = new StoppableHookableEventController<OnInteractEvent>();

    /////////////////////////////////

    let drivers_to_connect = {
      signui: makeSignuiDriver({
        minecraft_socket: minecraft_socket,
      }),
      serverlinks: serverlinks_driver({
        minecraft_socket: minecraft_socket,
      }),
      bossbars: makeBossbarsDriver({
        minecraft_socket: minecraft_socket,
      }),
      playerlist: makePlayerlistDriver({
        minecraft_socket: minecraft_socket,
      }),
      entities: makeEntitiesDriver({
        minecraft_socket: minecraft_socket,
      }),
      resourcepacks: makeResourcepacksDriver({
        minecraft_socket: minecraft_socket,
      }),
      inventory: makeInventoryDriver({
        /// Currently passing this to makeInventoryDriver... want to eventually pass it to a plugin instead
        inventory: survival_inventory,
        minecraft_socket: minecraft_socket,
      }),
      position: makePositionDriver({
        initial_position: player_from_persistence.position,
        minecraft_socket: minecraft_socket,
      }),
      windows_v1: makeWindowsV1Driver({
        inventory: survival_inventory,
        minecraft_socket: minecraft_socket,
      }),
      chat: makeChatDriver({
        minecraft_socket: minecraft_socket,
        uuid: uuid,
        username: username,
      }),
      playerstate: makePlayerstateDriver({
        player_entity_id: player_entity_id,
        minecraft_socket: minecraft_socket,
      }),
    } satisfies { [key: string]: Driver_v1<any> };

    type InputForDriver<Driver extends Driver_v1<any>> =
      Driver extends Driver_v1<infer Input> ? Input : never;

    let driver_signalcontrollers = mapValues(
      drivers_to_connect,
      () => new SwitchSignalController(new Signal.State([]))
    ) as any as {
      [key in keyof typeof drivers_to_connect]: SwitchSignalController<
        Array<InputForDriver<(typeof drivers_to_connect)[key]>>
      >;
    };

    let driver_inputs = mapValues(driver_signalcontrollers, (controller) =>
      controller.signal()
    ) as {
      [key in keyof typeof drivers_to_connect]: AnySignal<
        Array<InputForDriver<(typeof drivers_to_connect)[key]>>
      >;
    };

    let world_mapped = my_chunk_world.map_drivers(null, driver_inputs);

    let drivers = mapValues(drivers_to_connect, (driver, key) =>
      driver({
        input$: world_mapped[key],
        effect: effect_for_drivers,
        signal: signal,
      })
    ) as {
      [key in keyof typeof drivers_to_connect]: ReturnType<
        (typeof drivers_to_connect)[key]
      >;
    };

    /////////////////////////////////

    let player = new BasicPlayer({
      entity_id: player_entity_id,
      name: username,
      texture: texture,
      uuid: uuid,
      teleport: drivers.position.teleport,
      position$: drivers.position.position$,
      view_distance$: view_distance$,
      on_interact_v1: on_interact.listener(),
      survival_inventory: survival_inventory,

      chat: drivers.chat,
    });

    console.log("Adding!");
    // world.players.add(uuid.toBigInt(), player);
    my_chunk_world.join({
      player: player,
      signal: signal,
      socket: minecraft_socket,
    });
    /// This should be in a plugin that can be shared...?
    server_broadcast_stream.on(
      ({ message }) => {
        drivers.chat.send(message);
      },
      { signal }
    );
    chat_stream.on(
      ({ message, sender }) => {
        drivers.chat.chat(message, sender);
      },
      { signal }
    );

    let plugin_context = {
      world: world,
      player: player,
      send_packet: (packet: Uint8Array) => {
        minecraft_socket.send(packet);
      },
      signal: signal,

      send_broadcast: (message) => {
        server_broadcast_stream.emit(message);
      },
      send_chat: (message) => {
        chat_stream.emit(message);
      },

      signui: drivers.signui,
      inventory: drivers.inventory,
      windows_v1: drivers.windows_v1,
      position: drivers.position,
      chat: drivers.chat,
    } as Plugin_v1_Args;

    let plugins$ = new Signal.State<Array<Plugin_v1>>(
      plugins.map((plugin) => plugin(plugin_context))
    );

    for (let [key, controller] of Object.entries(driver_signalcontrollers)) {
      controller.set_signal(
        combine_sinks(plugins$, (plugin) => plugin.sinks?.[`${key}$`]) as any
      );
    }

    ////////////////////////////////////////////////////////////

    /// TODO I feel like the commands should be in a plugin
    let commands$ = combine_sinks(plugins$, (plugin) =>
      plugin.commands == null ? null : new Signal.State(plugin.commands)
    );
    commands_driver({
      minecraft_socket: minecraft_socket,
      player: player,
      getContext: () => ({
        player: player,
        players: new Map(
          driver_inputs.playerlist
            .get()
            .flatMap((pluginlist) =>
              Array.from(pluginlist).map(([uuid, player]) => [
                player.name,
                uuid,
              ])
            )
        ),
      }),
    })({ input$: commands$, signal: signal, effect: effect_for_drivers });

    keepalive_driver({
      minecraft_socket: minecraft_socket,
      signal: signal,
    });

    ////////////////////////////////////////////////////////////

    // minecraft_socket.on_packet["minecraft:custom_payload"].on(
    //   (packet) => {
    //     let { channel, data } =
    //       PlayPackets.serverbound.custom_payload.read(packet);

    //     let null_separated_strings = {
    //       encode: (strings) => {
    //         let buffers: Array<Uint8Array> = [];
    //         for (let string of strings) {
    //           buffers.push(new TextEncoder().encode(string));
    //           buffers.push(new Uint8Array([0]));
    //         }
    //         return concat(buffers);
    //       },
    //       decode: (buffer) => {
    //         let strings: Array<string> = [];
    //         let current: Array<number> = [];
    //         for (let byte of buffer) {
    //           if (byte === 0) {
    //             strings.push(new TextDecoder().decode(new Uint8Array(current)));
    //             current = [];
    //           } else {
    //             current.push(byte);
    //           }
    //         }
    //         strings.push(new TextDecoder().decode(new Uint8Array(current)));
    //         return [strings, buffer.length];
    //       },
    //     } as Protocol<Array<string>>;

    //     if (channel === "minecraft:brand") {
    //       let string = new TextDecoder().decode(data);
    //       console.log(
    //         `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(`minecraft:brand`)} ${string}`
    //       );
    //     } else if (channel === "minecraft:register") {
    //       let [channels] = null_separated_strings.decode(data);
    //       console.log(
    //         `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(`minecraft:register`)} ${channels}`
    //       );
    //     } else {
    //       console.log(
    //         `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(channel)}`
    //       );
    //       console.log(chalk.gray(uint8array_as_hex(data)));
    //     }
    //   },
    //   { signal }
    // );

    // let advancement_id = v4();
    // let advancement_id_2 = v4();
    // let advancement_id_3 = v4();
    // minecraft_socket.send(
    //   PlayPackets.clientbound.update_advancements.write({
    //     advancements: [
    //       {
    //         id: advancement_id,
    //         advancement: {
    //           criteria: [["Huh"]],
    //           // display: null,
    //           display: {
    //             description: "Heya",
    //             // display: {
    //             //   type: "background_and_show_toast",
    //             //   value:
    //             //     "minecraft:textures/gui/advancements/backgrounds/adventure.png",
    //             // },
    //             // display: {
    //             //   type: "background_and_show_toast",
    //             //   value:
    //             //     "minecraft:textures/gui/advancements/backgrounds/stone.png",
    //             // },
    //             // display: { type: "show_toast", value: undefined },
    //             // display: {
    //             //   type: "background_and_show_toast",
    //             //   value: "minecraft:textures/gui/inworld_menu_background.png",
    //             // },
    //             display: {
    //               type: "background_and_show_toast",
    //               value:
    //                 "minecraft:textures/gui/advancements/backgrounds/nether.png",
    //             },

    //             frame: "task",
    //             icon: slot_to_packetable({
    //               count: 1,
    //               item: "minecraft:stone",
    //               properties: {},
    //             }),
    //             title: "WOOOOP",
    //             x: 100,
    //             y: 1,
    //           },
    //           parent: null,
    //           telemetry: false,
    //         },
    //       },
    //       {
    //         id: advancement_id_2,
    //         advancement: {
    //           criteria: [["Huh"]],
    //           // display: null,
    //           display: {
    //             title: "Sweetwater",
    //             description: "Go 100 chunks out of the spawn area",
    //             display: {
    //               type: "show_toast",
    //               value: undefined,
    //             },
    //             frame: "challenge",
    //             icon: slot_to_packetable({
    //               count: 1,
    //               item: "minecraft:stone",
    //               properties: {},
    //             }),
    //             x: 101,
    //             y: 1,
    //           },
    //           parent: advancement_id,
    //           telemetry: false,
    //         },
    //       },
    //       {
    //         id: advancement_id_3,
    //         advancement: {
    //           criteria: [["Huh"]],
    //           // display: null,
    //           display: {
    //             display: { type: "show_toast", value: undefined },
    //             frame: "goal",
    //             icon: slot_to_packetable({
    //               count: 1,
    //               item: "minecraft:diamond_pickaxe",
    //               properties: {},
    //             }),
    //             title: "WOOOOP 2\nMore?",
    //             description: "Heya\nAnd more",
    //             x: 101,
    //             y: 2,
    //           },
    //           parent: advancement_id,
    //           telemetry: false,
    //         },
    //       },
    //     ],
    //     removed: [],
    //     progress: [
    //       {
    //         identifier: advancement_id,
    //         value: [
    //           {
    //             identifier: "Huh",
    //             achieved: BigInt(Date.now()),
    //           },
    //         ],
    //       },
    //     ],
    //     reset: false,
    //   })
    // );

    let build = new ProcessV1(
      ({ signal }) => {
        minecraft_socket.on_packet["minecraft:player_action"].on(
          async (packet) => {
            try {
              let { action, location, face, sequence } =
                PlayPackets.serverbound.player_action.read(packet);

              if (action === "start_digging") {
                let item = survival_inventory.item_holding;

                let interaction_response = on_interact.run({
                  item: item,
                  target: {
                    type: "block",
                    position: location,
                    face: face,
                    cursor: { x: 0.5, y: 0.5, z: 0.5 },
                  },
                  type: "attack",
                });

                minecraft_socket.send(
                  PlayPackets.clientbound.block_changed_ack.write({
                    sequence_id: sequence,
                  })
                );
              } else {
                console.log(
                  chalk.blue(`[PLAY]`),
                  chalk.red(`player_action`),
                  chalk.white(`${action}`),
                  chalk.yellow(`${face}`),
                  chalk.green(`${sequence}`)
                );
              }
            } catch (e) {
              console.error(e);
            }
          },
          { signal }
        );

        minecraft_socket.on_packet["minecraft:use_item_on"].on(
          async (packet) => {
            let { cursor, face, location, hand, sequence } =
              PlayPackets.serverbound.use_item_on.read(packet);

            /// Not sure why off_hand is always sent too
            if (hand === "off_hand") {
              minecraft_socket.send(
                PlayPackets.clientbound.block_changed_ack.write({
                  sequence_id: sequence,
                })
              );
              return;
            }

            let item = survival_inventory.item_holding;

            let interaction_response = on_interact.run({
              item: item,
              target: {
                type: "block",
                position: location,
                face: face,
                cursor: cursor,
              },
              type: "interact",
            });

            minecraft_socket.send(
              PlayPackets.clientbound.block_changed_ack.write({
                sequence_id: sequence,
              })
            );
          },
          { signal }
        );
      },
      { signal: signal }
    );

    /// player_command has nothing to do with /commands !!!
    minecraft_socket.on_packet["minecraft:player_command"].on(
      (packet) => {
        let { command, entity_id, jump_boost } =
          PlayPackets.serverbound.player_command.read(packet);

        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(
            `minecraft:player_command`
          )} ${chalk.green(command)} ${chalk.yellow(entity_id)} ${chalk.red(
            jump_boost
          )}`
        );
      },
      { signal }
    );
    minecraft_socket.on_packet["minecraft:swing"].on(
      (packet) => {
        let { hand } = PlayPackets.serverbound.swing.read(packet);
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(
            `minecraft:swing`
          )} ${chalk.green(hand)}`
        );
      },
      { signal }
    );

    effectWithSignal(signal, () => {
      set_player_to_persistence(uuid, {
        position: player.position,
        inventory: survival_inventory.inventory$.get(),
        last_login: new Date(),
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

      if (listener.has_listener) {
        try {
          listener.emit(packet);
        } catch (error) {
          console.error(
            chalk.red(`Error while processing packet: ${packet_name}`),
            error
          );
        }
      } else {
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.red(
            find_packet_name({
              id: packet_id,
              state: "play",
              direction: "serverbound",
            })
          )} ${format_packet_id(packet_id)}`
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));
      }
    }

    console.log(chalk.red("CONNECTION CLOSED!"));
  } finally {
    try {
      // world.players.remove(uuid.toBigInt());
    } catch (error) {
      console.error(
        chalk.red("Error while removing player from world...."),
        error
      );
    }
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
