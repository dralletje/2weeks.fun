import { blocks, find_packet_name } from "@2weeks/minecraft-data";
import chalk from "chalk";
import { floor, isEqual, range, zip } from "lodash-es";
import { Signal } from "signal-polyfill";
import {
  BasicPlayer,
  type Hotbar,
  type OnInteractEvent,
  type Slot,
  slot_data_to_slot,
  slot_to_packetable,
} from "./BasicPlayer.ts";
import { type Bossbar, makeBossbarsDriver } from "./Drivers/bossbars_driver.ts";
import { commands_driver } from "./Drivers/commands_driver.ts";
import { type Entity, makeEntitiesDriver } from "./Drivers/entities_driver.ts";
import { keepalive_driver } from "./Drivers/keepalive_driver.ts";
import { makePlayerlistDriver } from "./Drivers/playerlist_driver.ts";
import {
  type ResourcepackRequest,
  makeResourcepacksDriver,
} from "./Drivers/resourcepacks_driver.ts";
import {
  type Serverlink,
  serverlinks_driver,
} from "./Drivers/serverlinks_driver.ts";
import { time_driver } from "./Drivers/time_driver.ts";
import { mcp } from "./mcp.ts";
import { PlayPackets } from "./minecraft-protocol.ts";
import {
  type DuplexStream,
  MinecraftPlaySocket,
} from "./MinecraftPlaySocket.ts";
import { emplace } from "./packages/immappable.ts";
import { LockableEventEmitter } from "./packages/lockable-event-emitter.ts";
import { SingleEventEmitter } from "./packages/single-event-emitter.ts";
import { ChunkWorld } from "./ChunkWorld.ts";
import { type Driver_v1 } from "./PluginInfrastructure/Driver_v1.ts";
import {
  type ListedPlayer,
  type Plugin_v1,
  type Plugin_v1_Args,
} from "./PluginInfrastructure/Plugin_v1.ts";
import { World } from "./PluginInfrastructure/World.ts";
import brigadier from "./plugins/brigadier.ts";
import smite_plugin from "./plugins/give.smite.ts";
import give_plugin from "./plugins/give.ts";
import list_self_plugin from "./plugins/list_self.ts";
import map_plugin from "./plugins/map/map.ts";
import npc_plugin from "./plugins/npc.ts";
import show_other_players_plugin from "./plugins/show-other-players.ts";
import summon_plugin from "./plugins/summon.ts";
import tp_plugin from "./plugins/tp.ts";
import window_plugin from "./plugins/window.ts";
import { combined, concat, native, type Protocol } from "./protocol.ts";
import { type TextComponent } from "./protocol/text-component.ts";
import { type AnySignal, effectWithSignal } from "./signals.ts";
import { entity_id_counter, NumberCounter } from "./Unique.ts";
import { chat } from "./utils/chat.ts";
import {
  hex_to_uint8array,
  uint8array_as_hex,
} from "./utils/hex-x-uint8array.ts";
import { modulo_cycle } from "./utils/modulo_cycle.ts";
import { UUID } from "./utils/UUID.ts";
import { makePositionDriver } from "./Drivers/position_driver.ts";
import { type Vec2, vec2, vec3 } from "./utils/vec3.ts";
import { json_to_nbtish, nbtish_to_json } from "./protocol/nbt-json.ts";
import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import op_plugin from "./plugins/op.ts";
import display_plugin from "./plugins/display.ts";
import { type CardinalDirection } from "./PluginInfrastructure/MinecraftTypes.ts";
import { makeStatusbarDriver } from "./Drivers/statusbar_driver.ts";
import worldedit_plugin from "./plugins/worldedit.ts";
import { StoppableHookableEventController } from "./packages/stopable-hookable-event.ts";
import { v4 } from "uuid";
import { ChunkWorldDontCopyEntities } from "./ChunkWorldDontCopyEntities.ts";
import { DatabaseSync } from "node:sqlite";
import default_build_plugin from "./plugins/default_build.ts";
import navigate_plugin from "./plugins/navigate.ts";
import { makeSignuiDriver } from "./Drivers/signui_driver.ts";
import summon_with_eggs_plugin from "./plugins/summon_with_eggs.ts";
import build_preview_plugin from "./plugins/build-preview.ts";

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

// database.exec(`
//   DROP TABLE IF EXISTS block_entity_v2
// `);

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

let chat_stream = new SingleEventEmitter<{
  message: string;
  sender: { uuid: bigint; name: string };
}>();
let broadcast_stream = new SingleEventEmitter<{
  message: TextComponent | string;
}>();

type Position = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

let format_packet_id = (id: number) => `0x${id.toString(16).padStart(2, "0")}`;

let players_persistence = new Map<
  bigint,
  { hotbar: Hotbar; position: Position; last_login: Date }
>();

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

  let player_from_persistence = emplace(players_persistence, uuid.toBigInt(), {
    insert: () => ({
      hotbar: [null, null, null, null, null, null, null, null, null] as Hotbar,
      position: { x: 0, y: 6, z: 0, yaw: 0, pitch: 0 },
      last_login: new Date(),
    }),
    update: (player) => ({
      ...player,
      last_login: new Date(),
    }),
  });

  let player_broadcast_stream = new LockableEventEmitter<{
    message: TextComponent | string;
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
        game_mode: "creative",
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

    minecraft_socket.send(
      PlayPackets.clientbound.game_event.write({
        event: { type: "start_waiting_for_level_chunks" },
      })
    );

    let position_driver = makePositionDriver({
      initial_position: player_from_persistence.position,
      minecraft_socket: minecraft_socket,
    })({
      signal: signal,
      effect: effect_for_drivers,
      input$: new Signal.State([]),
    });

    chat_stream.on(
      ({ message, sender }) => {
        // minecraft_socket.send(
        //   PlayPackets.clientbound.player_chat.write({
        //     header: {
        //       index: 0,
        //       sender: sender.uuid,
        //       signature: null,
        //     },
        //     body: {
        //       message: message,
        //       salt: 0n,
        //       timestamp: BigInt(Date.now()),
        //     },
        //     previous_messages: [],
        //     formatting: {
        //       chat_type: 1,
        //       sender_name: `§9${sender.name}`,
        //       target_name: null,
        //     },
        //     other: {
        //       content: `${message}`,
        //     },
        //   })
        // );

        minecraft_socket.send(
          PlayPackets.clientbound.system_chat.write({
            message: chat`${chat.dark_purple(sender.name)}: ${message}`,
            is_action_bar: false,
          })
        );
      },
      { signal: signal }
    );

    let field_of_view_modifier$ = new Signal.State(0.1);
    let flags$ = new Signal.State(
      new Set(["creative_mode", "allow_flying", "invulnerable"]) as Set<
        "creative_mode" | "allow_flying" | "invulnerable" | "flying"
      >
    );
    let flying_speed$ = new Signal.State(0.1);

    effectWithSignal(signal, () => {
      let flags = flags$.get();
      let flying_speed = flying_speed$.get();
      let field_of_view_modifier = field_of_view_modifier$.get();
      minecraft_socket.send(
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
      { signal: signal }
    );

    minecraft_socket.send(
      PlayPackets.clientbound.custom_chat_completions.write({
        action: "set",
        entries: ["@Notch"],
      })
    );

    minecraft_socket.on_packet["minecraft:chat"].on(
      async (packet) => {
        let chat = PlayPackets.serverbound.chat.read(packet);
        chat_stream.emit({
          message: chat.message,
          sender: {
            uuid: uuid.toBigInt(),
            name: username,
          },
        });
      },
      { signal: signal }
    );

    minecraft_socket.send(
      PlayPackets.clientbound.tab_list.write({
        header: "\n  §7Welcome to the server!  \nAnd more",
        footer: "§7Welcome to the server!",
      })
    );

    minecraft_socket.send(
      PlayPackets.clientbound.set_health.write({
        health: 20,
        food: 20,
        saturation: 5,
      })
    );

    let hotbar$ = new Signal.State(player_from_persistence.hotbar);
    let selected_hotbar_slot$ = new Signal.State(0);
    let on_interact = new StoppableHookableEventController<OnInteractEvent>();

    let player = new BasicPlayer({
      entity_id: player_entity_id,
      name: username,
      texture: texture,
      uuid: uuid,
      teleport: position_driver.teleport,
      position$: position_driver.position$,
      player_broadcast_stream: player_broadcast_stream,
      hotbar$: hotbar$,
      selected_hotbar_slot$: selected_hotbar_slot$,
      field_of_view_modifier$: field_of_view_modifier$,
      view_distance$: view_distance$,
      on_interact_v1: on_interact.listener(),
    });

    // world.players.add(uuid.toBigInt(), player);
    my_chunk_world.join({
      player: player,
      signal: signal,
      socket: minecraft_socket,
    });

    /////////////////////////////////

    class SwitchSignalController<T> {
      #signalsignal: Signal.State<AnySignal<T>>;
      constructor(signal: AnySignal<T>) {
        this.#signalsignal = new Signal.State(signal);
      }

      signal() {
        return new Signal.Computed(() => {
          return this.#signalsignal.get().get();
        });
      }
      set_signal(value: AnySignal<T>) {
        this.#signalsignal.set(value);
      }
    }

    let entities$_switch = new SwitchSignalController<
      Array<Map<bigint, Entity>>
    >(new Signal.State([]));
    let playerlist$_switch = new SwitchSignalController<
      Array<Map<bigint, ListedPlayer>>
    >(new Signal.State([]));
    let serverlinks$_switch = new SwitchSignalController<
      Array<Array<Serverlink>>
    >(new Signal.State([]));
    let bossbars$_switch = new SwitchSignalController<
      Array<Map<bigint, Bossbar>>
    >(new Signal.State([]));
    let resourcepacks$_switch = new SwitchSignalController<
      Array<Map<bigint, ResourcepackRequest>>
    >(new Signal.State([]));
    let statusbar$_switch = new SwitchSignalController<
      Array<TextComponent | string | void | null>
    >(new Signal.State([]));

    let world_mapped = my_chunk_world.map_drivers(player, {
      entities$: entities$_switch.signal(),
      playerlist$: playerlist$_switch.signal(),
    });

    let drivers = {
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
        player: player,
      }),
      resourcepacks: makeResourcepacksDriver({
        minecraft_socket: minecraft_socket,
      }),
      statusbar: makeStatusbarDriver({
        minecraft_socket: minecraft_socket,
      }),
    } satisfies { [key: string]: Driver_v1<any> };

    let driver_results = {
      signui: drivers.signui({
        input$: new Signal.State([]),
        effect: effect_for_drivers,
        signal: signal,
      }),
      serverlinks: drivers.serverlinks({
        input$: serverlinks$_switch.signal(),
        effect: effect_for_drivers,
        signal: signal,
      }),
      bossbars: drivers.bossbars({
        input$: bossbars$_switch.signal(),
        effect: effect_for_drivers,
        signal: signal,
      }),
      playerlist: drivers.playerlist({
        input$: world_mapped.playerlist$,
        effect: effect_for_drivers,
        signal: signal,
      }),
      entities: drivers.entities({
        input$: world_mapped.entities$,
        effect: effect_for_drivers,
        signal: signal,
      }),
      resourcepacks: drivers.resourcepacks({
        input$: resourcepacks$_switch.signal(),
        effect: effect_for_drivers,
        signal: signal,
      }),
      statusbar: drivers.statusbar({
        input$: statusbar$_switch.signal(),
        effect: effect_for_drivers,
        signal: signal,
      }),
    };

    /////////////////////////////////

    let plugin_context = {
      world: world,
      player: player,
      send_packet: (packet: Uint8Array) => {
        minecraft_socket.send(packet);
      },
      signal: signal,
      signui: driver_results.signui,
    } as Plugin_v1_Args;

    let plugins: Array<(arg: Plugin_v1_Args) => Plugin_v1> = [
      show_other_players_plugin,
      tp_plugin,
      brigadier,
      smite_plugin,
      summon_plugin,
      give_plugin,
      npc_plugin,
      window_plugin,
      map_plugin,
      list_self_plugin,
      op_plugin,
      display_plugin,
      worldedit_plugin,
      navigate_plugin,
      summon_with_eggs_plugin,
      build_preview_plugin,
      // noth_compass_plugin,
      // bossbar_plugin,
      default_build_plugin,
    ];

    let plugins$ = new Signal.State<Array<Plugin_v1>>([
      ...plugins.map((plugin) => plugin(plugin_context)),
      {
        sinks: {
          serverlinks$: new Signal.State([
            { label: { false: "Developer" }, url: "https://dral.dev" },
          ]),
        },
      },
      {
        sinks: {
          statusbar$: new Signal.Computed(() => {
            let player_facing: CardinalDirection =
              player.position.yaw > 360 - 45 || player.position.yaw < 45
                ? "south"
                : player.position.yaw < 135
                  ? "west"
                  : player.position.yaw < 225
                    ? "north"
                    : "east";

            return `Facing: ${player_facing}`;
          }),
        },
      },
    ]);

    broadcast_stream.on(
      ({ message }) => {
        writer.write(
          PlayPackets.clientbound.system_chat.write({
            message: message,
            is_action_bar: false,
          })
        );
      },
      { signal: signal }
    );
    player_broadcast_stream.on(
      ({ message }) => {
        writer.write(
          PlayPackets.clientbound.system_chat.write({
            message: message,
            is_action_bar: false,
          })
        );
      },
      { signal: signal }
    );

    // broadcast_stream.emit({ message: `§7* §9${username} §7joined the game` });
    broadcast_stream.emit({
      message: {
        text: "",
        extra: [
          { text: "* ", color: "dark_purple" },
          { text: `${username} joined the game` },
        ],
      },
    });

    /// STATIC TIME!
    let time$ = new Signal.State({ time: 1n, locked: true });

    /// QUICK TIME!
    // let actual_time$ = new TimeSignal(10, { signal });
    // let time$ = new Signal.Computed(() => {
    //   return { time: BigInt(actual_time$.get() * 10), locked: true };
    // });

    /// Time based on position!
    // let time$ = new Signal.Computed(() => {
    //   let position = position$.get();
    //   return {
    //     time: BigInt(
    //       Math.floor(
    //         ((Math.abs(position.x) / 16) ** 2 +
    //           (Math.abs(position.z) / 16) ** 2) *
    //           24000
    //       )
    //     ),
    //     locked: true,
    //   };
    // });

    /// Time based on movement!
    // let TIME_SPEED = 200;
    // let TIME_SPEED = 1000;
    // let time$ = new Signal.Computed(() => {
    //   let movement = movement$.get();
    //   return {
    //     time: BigInt(Math.ceil(movement * TIME_SPEED)) % 24000n,
    //     locked: true,
    //   };
    // });

    ////////////////////////////////////////////////////////////

    /// TODO
    // resourcepacks$_switch(new Signal.State(
    //   new Map<bigint, ResourcepackRequest>()
    // ))
    /// TODO
    let commands$ = combine_sinks(plugins$, (plugin) =>
      plugin.commands == null ? null : new Signal.State(plugin.commands)
    );

    entities$_switch.set_signal(
      combine_sinks(plugins$, (plugin) => plugin.sinks?.entities$)
    );
    playerlist$_switch.set_signal(
      combine_sinks(plugins$, (plugin) => plugin.sinks?.playerlist$)
    );
    bossbars$_switch.set_signal(
      combine_sinks(plugins$, (plugin) => plugin.sinks?.bossbars$)
    );
    serverlinks$_switch.set_signal(
      combine_sinks(plugins$, (plugin) => plugin.sinks?.serverlinks$)
    );
    statusbar$_switch.set_signal(
      combine_sinks(plugins$, (plugin) => plugin.sinks?.statusbar$)
    );

    ////////////////////////////////////////////////////////////

    commands_driver({
      minecraft_socket: minecraft_socket,
      player: player,
      getContext: () => ({
        player: player,
        players: new Map(
          playerlist$_switch
            .signal()
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
    time_driver({
      time$: time$,
      minecraft_socket: minecraft_socket,
      signal: signal,
    });

    ////////////////////////////////////////////////////////////

    minecraft_socket.on_packet["minecraft:set_carried_item"].on(
      async (packet) => {
        let { slot } = PlayPackets.serverbound.set_carried_item.read(packet);
        selected_hotbar_slot$.set(slot);
      },
      { signal: signal }
    );
    minecraft_socket.on_packet["minecraft:set_creative_mode_slot"].on(
      (packet) => {
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:set_creative_mode_slot`)}`
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));

        let { slot, clicked_item } =
          PlayPackets.serverbound["set_create_mode_slot"].read(packet);

        let slot_data = slot_data_to_slot(clicked_item);
        let hotbar_slot = slot - 36;
        if (hotbar_slot < 0 || hotbar_slot >= 9) {
          console.log(`Ignoring slot: ${slot}, not in hotbar`);
        } else {
          hotbar$.set(
            hotbar$.get().toSpliced(hotbar_slot, 1, slot_data) as Hotbar
          );
        }
      },
      { signal: signal }
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
    effectWithSignal(signal, async () => {
      let inventory = hotbar$.get();

      let i = 0;
      for (let [next, prev] of zip(inventory, _player_inventory)) {
        if (isEqual(next, prev)) {
          i += 1;
          continue;
        } else {
          minecraft_socket.send(
            PlayPackets.clientbound.container_set_slot.write({
              window_id: 0,
              slot: 36 + i,
              state_id: 0,
              slot_data: slot_to_packetable(next),
            })
          );
          i += 1;
        }
      }
    });

    minecraft_socket.on_packet["minecraft:custom_payload"].on(
      (packet) => {
        let { channel, data } =
          PlayPackets.serverbound.custom_payload.read(packet);

        let null_separated_strings = {
          encode: (strings) => {
            let buffers: Array<Uint8Array> = [];
            for (let string of strings) {
              buffers.push(new TextEncoder().encode(string));
              buffers.push(new Uint8Array([0]));
            }
            return concat(buffers);
          },
          decode: (buffer) => {
            let strings: Array<string> = [];
            let current: Array<number> = [];
            for (let byte of buffer) {
              if (byte === 0) {
                strings.push(new TextDecoder().decode(new Uint8Array(current)));
                current = [];
              } else {
                current.push(byte);
              }
            }
            strings.push(new TextDecoder().decode(new Uint8Array(current)));
            return [strings, buffer.length];
          },
        } as Protocol<Array<string>>;

        if (channel === "minecraft:brand") {
          let string = new TextDecoder().decode(data);
          console.log(
            `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(`minecraft:brand`)} ${string}`
          );
        } else if (channel === "minecraft:register") {
          let [channels] = null_separated_strings.decode(data);
          console.log(
            `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(`minecraft:register`)} ${channels}`
          );
        } else {
          console.log(
            `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:custom_payload`)} ${chalk.green(channel)}`
          );
          console.log(chalk.gray(uint8array_as_hex(data)));
        }
      },
      { signal }
    );

    minecraft_socket.on_packet["minecraft:client_information"].on(
      (packet) => {
        let information =
          PlayPackets.serverbound.client_information.read(packet);
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:client_information`)}`
          // information
        );
      },
      { signal }
    );

    let advancement_id = v4();
    let advancement_id_2 = v4();
    let advancement_id_3 = v4();
    minecraft_socket.send(
      PlayPackets.clientbound.update_advancements.write({
        advancements: [
          {
            id: advancement_id,
            advancement: {
              criteria: [["Huh"]],
              // display: null,
              display: {
                description: "Heya",
                // display: {
                //   type: "background_and_show_toast",
                //   value:
                //     "minecraft:textures/gui/advancements/backgrounds/adventure.png",
                // },
                display: {
                  type: "background_and_show_toast",
                  value:
                    "minecraft:textures/gui/advancements/backgrounds/stone.png",
                },
                // display: { type: "show_toast", value: undefined },
                frame: "task",
                icon: slot_to_packetable({
                  count: 1,
                  item: "minecraft:stone",
                  properties: {},
                }),
                title: "WOOOOP",
                x: 100,
                y: 1,
              },
              parent: null,
              telemetry: false,
            },
          },
          {
            id: advancement_id_2,
            advancement: {
              criteria: [["Huh"]],
              // display: null,
              display: {
                title: "Sweetwater",
                description: "Go 100 chunks out of the spawn area",
                display: {
                  type: "show_toast",
                  value: undefined,
                },
                frame: "challenge",
                icon: slot_to_packetable({
                  count: 1,
                  item: "minecraft:stone",
                  properties: {},
                }),
                x: 101,
                y: 1,
              },
              parent: advancement_id,
              telemetry: false,
            },
          },
          {
            id: advancement_id_3,
            advancement: {
              criteria: [["Huh"]],
              // display: null,
              display: {
                display: { type: "show_toast", value: undefined },
                frame: "goal",
                icon: slot_to_packetable({
                  count: 1,
                  item: "minecraft:diamond_pickaxe",
                  properties: {},
                }),
                title: "WOOOOP 2\nMore?",
                description: "Heya\nAnd more",
                x: 101,
                y: 2,
              },
              parent: advancement_id,
              telemetry: false,
            },
          },
        ],
        removed: [],
        progress: [
          {
            identifier: advancement_id,
            value: [
              {
                identifier: "Huh",
                achieved: BigInt(Date.now()),
              },
            ],
          },
        ],
        reset: false,
      })
    );

    // minecraft_socket.send(
    //   PlayPackets.clientbound.update_tags.write({
    //     registries: [
    //       {
    //         registry: "dral:idk",
    //         tags: [
    //           {
    //             name: "hi",
    //             entries: [],
    //           },
    //         ],
    //       },
    //     ],
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
                let interaction_response = on_interact.run({
                  item: hotbar$.get()[selected_hotbar_slot$.get()],
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

            let interaction_response = on_interact.run({
              item: hotbar$.get()[selected_hotbar_slot$.get()],
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
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:player_command`)} ${chalk.green(command)} ${chalk.yellow(entity_id)} ${chalk.red(jump_boost)}`
        );
      },
      { signal }
    );
    minecraft_socket.on_packet["minecraft:swing"].on(
      (packet) => {
        let { hand } = PlayPackets.serverbound.swing.read(packet);
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:swing`)} ${chalk.green(hand)}`
        );
      },
      { signal }
    );
    minecraft_socket.on_packet["minecraft:container_close"].on(
      (packet) => {
        let { container_id } =
          PlayPackets.serverbound.container_close.read(packet);
        console.log(
          `${chalk.blue(`[PLAY]`)} ${chalk.magenta(`minecraft:container_close`)} ${chalk.green(container_id)}`
        );
      },
      { signal }
    );

    effectWithSignal(signal, () => {
      emplace(players_persistence, uuid.toBigInt(), {
        update: (x) => {
          return {
            position: player.position,
            hotbar: hotbar$.get(),
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
          `${chalk.blue(`[PLAY]`)} ${chalk.red(find_packet_name({ id: packet_id, state: "play", direction: "serverbound" }))} ${format_packet_id(packet_id)}`
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
