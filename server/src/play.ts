import {
  blocks,
  find_packet_name,
} from "@2weeks/minecraft-data/src/minecraft-data.ts";
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
import { ChunkWorld } from "./PluginInfrastructure/ChunkWorld.ts";
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

let my_chunk_world = new ChunkWorld(
  range(0, 16).map((y) =>
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
  )
);

let Faces = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

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

    let view_distance$ = new Signal.State(5);

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
      // noth_compass_plugin,
      // bossbar_plugin,
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
                  target: { type: "block", position: location },
                  type: "left_click",
                });

                if (interaction_response == null) {
                  minecraft_socket.send(
                    PlayPackets.clientbound.block_changed_ack.write({
                      sequence_id: sequence,
                    })
                  );
                  return;
                }

                my_chunk_world.set_block({
                  position: location,
                  block: 0,
                  transaction_id: sequence,
                });
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

        let reverse_cardinal = (
          cardinal: CardinalDirection
        ): CardinalDirection => {
          switch (cardinal) {
            case "north":
              return "south";
            case "south":
              return "north";
            case "east":
              return "west";
            case "west":
              return "east";
          }
        };

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
              target: { type: "block", position: location },
              type: "right_click",
            });

            if (interaction_response == null) {
              minecraft_socket.send(
                PlayPackets.clientbound.block_changed_ack.write({
                  sequence_id: sequence,
                })
              );
              return;
            }

            let face_vector = Faces[face];

            let inventory = hotbar$.get();
            let slot = inventory[selected_hotbar_slot$.get()];

            if (slot) {
              let block = blocks[slot.item];

              if (slot.item === "minecraft:water_bucket") {
                block = blocks["minecraft:water"];
              }

              console.log(`block:`, block);

              if (block == null) {
                console.log(
                  chalk.blue(`[PLAY]`),
                  chalk.red(`Unknown block: ${slot.item}`)
                );
                player.send(
                  chat`${chat.dark_purple("*")} ${chat.gray("Unknown block: ")}${chat.yellow(slot.item)}`
                );
                return;
              }

              let block_position = {
                x: location.x + face_vector.x,
                y: location.y + face_vector.y,
                z: location.z + face_vector.z,
              };

              let player_position = player.position;

              let center_of_block = [
                block_position.x + 0.5,
                block_position.z + 0.5,
              ] as Vec2;

              if (
                floor(player_position.y) === block_position.y &&
                vec2.length(
                  vec2.subtract(center_of_block, vec3.xz(player_position))
                ) < 1
              ) {
                player.teleport({
                  ...player_position,
                  y: player_position.y + 1,
                });
              }

              let default_state = block.states.find((x) => x.default);

              if (default_state == null) {
                throw new Error("No default state??");
              }

              type Facing = "north" | "south" | "east" | "west";

              let D1 =
                cursor.x + cursor.z > 1
                  ? ("LEFT_TOP" as const)
                  : ("RIGHT_BOTTOM" as const);
              let D2 =
                cursor.x > cursor.z
                  ? ("LEFT_BOTTOM" as const)
                  : ("RIGHT_TOP" as const);
              let cardinal: Facing =
                D1 === "LEFT_TOP" && D2 === "LEFT_BOTTOM"
                  ? "east"
                  : D1 === "RIGHT_BOTTOM" && D2 === "RIGHT_TOP"
                    ? "west"
                    : D1 === "LEFT_TOP" && D2 === "RIGHT_TOP"
                      ? "south"
                      : "north";
              /// Turns out "TOP" is south

              let yaw = player_position.yaw;
              let state = default_state.id ?? 0;

              if (block.definition.type === "minecraft:door") {
                if (face === "top" || face === "bottom") {
                  let door_direction = reverse_cardinal(cardinal);

                  let lower = block.states.find((x) =>
                    isEqual(x.properties, {
                      ...default_state.properties,
                      facing: door_direction,
                      half: "lower",
                    })
                  )!;
                  let upper = block.states.find((x) =>
                    isEqual(x.properties, {
                      ...default_state.properties,
                      facing: door_direction,
                      half: "upper",
                    })
                  )!;

                  my_chunk_world.set_block({
                    position: block_position,
                    block: lower.id,
                    transaction_id: sequence,
                  });
                  my_chunk_world.set_block({
                    position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
                    block: upper.id,
                    transaction_id: sequence,
                  });
                } else {
                  let lower = block.states.find((x) =>
                    isEqual(x.properties, {
                      ...default_state.properties,
                      facing: face,
                      half: "lower",
                    })
                  )!;
                  let upper = block.states.find((x) =>
                    isEqual(x.properties, {
                      ...default_state.properties,
                      facing: face,
                      half: "upper",
                    })
                  )!;

                  my_chunk_world.set_block({
                    position: block_position,
                    block: lower.id,
                    transaction_id: sequence,
                  });
                  my_chunk_world.set_block({
                    position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
                    block: upper.id,
                    transaction_id: sequence,
                  });
                }
              } else if (block.definition.type === "minecraft:stair") {
                if (face === "top" || face === "bottom") {
                  /// Other than minecraft, I'm going to try to soley base the stair orientation
                  /// on where you click on the receiving block
                  /// (Because it might be cool, and because it is easier for now)

                  let expected_state = {
                    ...default_state.properties,
                    facing: cardinal,
                    half: face === "top" ? "bottom" : "top",
                  };

                  let y = block.states.find((x) =>
                    isEqual(x.properties, expected_state)
                  )!;
                  my_chunk_world.set_block({
                    position: block_position,
                    block: y.id,
                    transaction_id: sequence,
                  });
                } else {
                  let expected_state = {
                    ...default_state.properties,
                    facing: reverse_cardinal(face),
                    half: cursor.y > 0.5 ? "top" : "bottom",
                  };

                  let y = block.states.find((x) =>
                    isEqual(x.properties, expected_state)
                  )!;
                  my_chunk_world.set_block({
                    position: block_position,
                    block: y.id,
                    transaction_id: sequence,
                  });
                }
              } else if (block.definition.type === "minecraft:structure") {
                /// Structured block chenanigans!!
                /// ... These can show a line around a region, which I want to (abuse) for worldedit stuff
                /// ... So this is a showcase of that!
                minecraft_socket.send(
                  PlayPackets.clientbound.block_update.write({
                    location: {
                      x: block_position.x,
                      y: 0,
                      z: block_position.z,
                    },
                    block: 19356,
                  })
                );

                /// I don't have a way to store block entities yet
                // my_chunk_world.set_block({
                //   position: {
                //     ...block_position,
                //     y: -65,
                //   },
                //   block: 19356,
                //   transaction_id: sequence,
                // });

                minecraft_socket.send(
                  PlayPackets.clientbound.block_entity_data.write({
                    location: {
                      ...block_position,
                      y: 0,
                    },
                    type: 20,
                    // nbt: structure_block_metadata.nbt,
                    nbt: json_to_nbtish({
                      author: "?",
                      ignoreEntities: true,
                      integrity: 1,
                      // metadata: "",
                      mirror: "NONE",
                      mode: "SAVE",
                      name: "Hi",
                      posX: 0,
                      posY: block_position.y + 65,
                      posZ: 0,
                      powered: false,
                      rotation: "NONE",
                      seed: 0n,
                      showboundingbox: true,
                      sizeX: 10,
                      sizeY: 10,
                      sizeZ: 10,
                    }),
                  })
                );
              } else if (block.definition.type === "minecraft:sign") {
                /// Set some default text on signs, just to show
                /// it is possible!
                my_chunk_world.set_block({
                  position: block_position,
                  block: state,
                  transaction_id: sequence,
                });
                minecraft_socket.send(
                  PlayPackets.clientbound.block_entity_data.write({
                    location: block_position,
                    type: 7,
                    // nbt: p.nbt,
                    nbt: json_to_nbtish({
                      back_text: {
                        has_glowing_text: false,
                        color: "black",
                        messages: ['"HELLO THRE"', '""', '""', '""'],
                      },
                      is_waxed: false,
                      front_text: {
                        has_glowing_text: false,
                        color: "black",
                        messages: [
                          JSON.stringify("hi"),
                          JSON.stringify(""),
                          JSON.stringify(""),
                          JSON.stringify(""),
                        ],
                      },
                    }),
                  })
                );
              } else {
                my_chunk_world.set_block({
                  position: block_position,
                  block: state,
                  transaction_id: sequence,
                });
              }
            }

            player.send(`Block placed!`);
            player.send(`  Cursor ${cursor.x}, ${cursor.y}, ${cursor.z}`);
            player.send(
              `  Location ${location.x}, ${location.y}, ${location.z}`
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

    // minecraft_socket.send(
    //   PlayPackets.clientbound.block_entity_data.write({
    //     location: { x: 0, y: -55, z: 0 },
    //     type: 14,
    //     nbt: json_to_nbtish({
    //       posX: 0,
    //       posY: -55,
    //       posZ: 0,
    //       mode: "SAVE",
    //       showboundingbox: true,
    //       sizeX: 10,
    //       sizeY: 10,
    //       sizeZ: 10,
    //     }),
    //   })
    // );

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

// let hex = `07 00 00 00 00 00 00 0f c4 07 0a 0a 00 09 62 61 63 6b 5f 7465 78 74 01 00 10 68 61 73 5f 67 6c 6f 77 69 6e 67 5f 74 6578 74 00 08 00 05 63 6f 6c 6f 72 00 05 62 6c 61 63 6b 09 0008 6d 65 73 73 61 67 65 73 08 00 00 00 04 00 02 22 22 00 0222 22 00 02 22 22 00 02 22 22 00 01 00 08 69 73 5f 77 61 7865 64 00 0a 00 0a 66 72 6f 6e 74 5f 74 65 78 74 01 00 10 6861 73 5f 67 6c 6f 77 69 6e 67 5f 74 65 78 74 00 08 00 05 636f 6c 6f 72 00 05 62 6c 61 63 6b 09 00 08 6d 65 73 73 61 6765 73 08 00 00 00 04 00 04 22 68 69 22 00 02 22 22 00 02 2222 00 02 22 22 00 00`;
// let bytes = hex_to_uint8array(hex);
// let p = PlayPackets.clientbound.block_entity_data.read(
//   encode_with_varint_length(bytes)
// );

// let structure_block_bytes = hex_to_uint8array(
//   "8f 02 07 ff ff ff 7f ff ff df c4 14 0a 08 00 08 6d 65 74 6164 61 74 61 00 00 08 00 06 6d 69 72 72 6f 72 00 04 4e 4f 4e45 01 00 0e 69 67 6e 6f 72 65 45 6e 74 69 74 69 65 73 01 0100 07 70 6f 77 65 72 65 64 00 04 00 04 73 65 65 64 00 00 0000 00 00 00 00 08 00 06 61 75 74 68 6f 72 00 0b 6d 69 63 6869 65 6c 64 72 61 6c 08 00 08 72 6f 74 61 74 69 6f 6e 00 044e 4f 4e 45 03 00 04 70 6f 73 58 00 00 00 00 08 00 04 6d 6f64 65 00 04 53 41 56 45 03 00 04 70 6f 73 59 00 00 00 01 0300 05 73 69 7a 65 58 00 00 00 0a 03 00 04 70 6f 73 5a 00 0000 00 05 00 09 69 6e 74 65 67 72 69 74 79 3f 80 00 00 01 0007 73 68 6f 77 61 69 72 00 08 00 04 6e 61 6d 65 00 0b 6d 696e 65 63 72 61 66 74 3a 69 03 00 05 73 69 7a 65 59 00 00 000a 03 00 05 73 69 7a 65 5a 00 00 00 0a 01 00 0f 73 68 6f 7762 6f 75 6e 64 69 6e 67 62 6f 78 01 00"
// );
// let structure_block_metadata = PlayPackets.clientbound.block_entity_data.read(
//   structure_block_bytes
// );

// console.log(`structure_block_metadata:`, structure_block_metadata);
// console.log(
//   `structure_block_metadata.nbt:`,
//   nbtish_to_json(structure_block_metadata.nbt)
// );

// let structure_block_recoded = PlayPackets.clientbound.block_entity_data.write(
//   structure_block_metadata
// );

// let block_update = PlayPackets.clientbound.block_update.read(
//   hex_to_uint8array("0c 09 ff ff ff 7f ff ff df c4 9c 97 01")
// );
// console.log(`block_update:`, block_update);

// console.log(
//   `Play Abilities:`,
//   PlayPackets.clientbound.player_abilities.read(
//     hex_to_uint8array("0a 38 0d 3d 4c cc cd 3d cc cc cd")
//   )
// );

// console.log(
//   `isEqual(structure_block_bytes, structure_block_recoded):`,
//   isEqual(structure_block_bytes, structure_block_recoded)
// );

// let x = PlayPackets.clientbound.set_entity_data.read(
//   hex_to_uint8array("0c 58 09 09 03 41 a0 00 00 11 00 7f ff")
// );

// console.log(`x:`, JSON.stringify(x, null, 2));
// console.log(`p:`, JSON.stringify(p.nbt.value, null, 2));

// let g = ;
// console.log(`g:`, JSON.stringify(g.value, null, 2));

// console.log(`isEqual(g, p.nbt):`, isEqual(g, p.nbt));

let x = PlayPackets.clientbound.section_blocks_update.read(
  encode_with_varint_length(
    hex_to_uint8array("49 00 0b d8 00 06 40 00 07 02 fd 03 fd a5 02")
  )
);
console.log(`x:`, x.blocks);

try {
  let achievements = PlayPackets.clientbound.update_advancements.read(
    hex_to_uint8array(
      "8a c8 01 c2 f5 0a 78 9c bc 5a 5f 8f dc 34 10 f7 96 d2 5e 8b5a 5a 28 05 d1 52 40 45 94 52 7a 5b 28 6d 0f 5e 7a 48 48 4848 80 84 2a 84 a0 92 99 24 b3 89 b5 8e 1d 6c e7 b6 cb 53 5ff8 0e 7c 9c 7e 19 9e e1 23 80 9d ec 6d b2 c9 26 71 b6 70 0fa7 1d 27 33 b6 c7 33 bf f9 e3 98 c9 5f 2f 5e 4f 99 c0 50 c1cc 7c ae 30 64 19 ea a9 91 92 eb e9 8c e9 84 89 98 2a 19 4d2e 37 5f 52 52 1a 32 39 71 3e 01 4d 4d 82 b4 18 3f 6b 49 6d14 13 31 79 af c9 14 61 28 15 18 26 85 9e ea 54 ce 51 0d 17fd 92 25 67 b9 12 10 22 79 d0 2d 3b cb 55 c6 91 6a 03 4c 6044 63 0e 5a d3 0c 04 0e 9f ee 8c 25 1d 23 39 68 f2 04 39 e391 d5 4e c0 65 38 d7 d3 4c 72 a6 13 8c 28 88 08 35 33 48 3587 60 f8 6c af 59 b2 21 84 dc eb 9f 39 e0 10 ce eb 3b 1d b5c9 c4 63 93 6e 4e 6d a4 40 1a 28 56 4e af 34 9d 29 99 d2 b6b7 dc ff 30 37 86 89 78 f8 ea 5e af 29 65 2d 8e fc d2 bf d605 82 49 50 61 44 c3 dc d0 50 66 19 aa da 32 2b 2f ac 1e 8e59 e3 25 4b 6e ca 22 ef b4 b0 63 e4 66 98 72 3c f2 31 fb 972d 19 ca 20 e0 58 6c fe 83 0e d9 10 42 c8 80 06 b9 31 52 787a 6d c6 41 cc 35 69 c1 83 50 a6 01 98 29 53 52 50 bd 90 ca03 0f 1c e9 18 99 88 a5 21 fb fd 27 57 b1 2b 5f 4b 2e 14 f47e 87 82 74 a6 f2 10 69 24 a5 1a a7 9e 4f 3d dc 24 42 cc 3407 83 9e 38 50 9c 76 85 9f fc d8 3f 6b 98 30 8d 35 ae c2 ce1b c2 46 1a fa 96 95 fd dc bf 32 eb 17 02 ad 83 ac d0 82 4350 2c 6e f3 91 de 65 71 0d 61 e4 7e ff e2 38 4b 91 86 52 840a 0d d2 4c 2e a2 2e e7 7c 61 63 de 3d 67 75 20 22 67 22 b182 23 e4 e4 ab ee d8 b4 44 ce e5 a2 25 36 15 2a 19 12 ab 5e68 f3 b2 35 a3 23 cb 69 a2 25 92 2f 07 58 8f 82 70 8e 11 dd0a f1 1e ae 78 6d 0b 6c af 4e 65 80 0b 2d e0 c9 1a 98 63 e5e5 42 97 1d 22 57 05 38 a1 e4 6e ff b4 0d 2b 1d 3e eb 45 4bd6 ad ef 81 87 d3 8e d3 f4 69 47 42 3c 44 a5 b1 82 e5 73 4813 ee 34 79 52 a6 c3 69 c6 c4 dc 1a 5b 99 03 58 2a 43 03 5c7b 46 ba 0a 67 5b 02 59 a4 a6 2e a0 64 2c 9c c3 13 1c 1f 8b06 a4 75 a5 13 3d 5f 7c f8 a8 3f 3e cd 50 84 48 63 2f bb af46 a9 1b 5b 83 38 2f 52 15 9a 20 4f d1 78 66 df 25 33 39 f408 82 cd 5c d1 cb af fa c0 e4 da 5a 50 92 eb 00 44 a4 96 d399 92 31 67 71 62 f4 e4 56 db 73 8e a0 13 0a 9c 53 fb 26 3d02 c5 40 18 3d 39 bb 47 ce 18 05 a2 08 6d 37 20 3a 02 11 628a c2 e8 fd 63 ee fd b5 f4 7d c3 0c 47 52 67 bb dd cf 16 a10e 15 cb 6c 3c 20 93 bf cf 10 32 21 84 9c 38 3c 24 e4 8b 0342 26 93 b3 95 0d b4 58 4b 35 9a b8 27 56 ef 06 02 ee 61 2d17 73 61 0f 8a 2a 3b 0b 85 05 2c c9 67 1e a7 1a 2b 10 ae ca71 19 b5 67 ba bc 29 65 48 9c 6e ab e8 46 01 d8 9b 5b 00 2c85 cc d3 1b 42 99 66 56 e2 dd ee 13 6a a4 3f 0b e0 7c e7 d4e6 a7 7e 95 45 a0 e6 34 53 4c a7 a0 98 c0 5a f5 d3 7c 36 26ed 7a d5 92 1b a2 c8 74 e0 ca 24 f8 62 41 15 e1 7a dc 22 cda3 51 da 76 e4 31 73 6b 35 54 f3 be 04 b5 f1 4c 12 b8 34 9aca 19 65 06 d3 9a 39 6a 23 d5 72 6a 9b 2e 4b 1a 23 a8 c9 d5cd 67 96 a6 11 83 54 8a 68 03 ac ae d7 50 c7 bd be bf 16 d50a 54 37 bb 59 6a 20 f5 e7 29 e2 fe 4e 1c 3e 23 e4 e1 33 4226 27 cf 97 0b 29 43 c9 2b 2b d2 e9 24 b3 33 5c 58 0d 71 8c63 26 62 7d 6e 35 10 48 69 f4 e4 d2 7a 7f 28 a2 29 f2 a5 5130 b9 52 1f 9d 31 11 51 b4 72 99 59 6e 6c fa ad da 0e 50 44fb 85 8c d6 ed 5e df f6 72 6d a3 bf 9f 22 e4 84 db e8 d3 72a3 93 53 e5 c2 0e 7a 4c 0e 62 14 06 9e 57 d3 e9 bb 7e 37 6acd 1e 4b c2 79 f9 38 af ae 94 d2 07 03 16 d1 ac 2f fd 3b 5fcd ba b2 a5 51 e0 8e 32 93 ca 38 85 4f 53 10 b1 92 47 48 0309 1e 3e b8 c7 04 5d 80 41 d5 d9 48 29 f3 b0 5d 1a 29 b7 facc a5 5c be 66 b1 d8 39 cb 5b e7 36 06 a2 4c 72 a4 4c 50 db08 0a e7 68 26 6f b4 bd 68 e5 6f f8 d3 9d 2d a9 4b 8b cc 5617 bb ef c1 5f f3 ba 3f 4e 97 f0 f2 f0 e9 2a 07 3a bf 62 2af7 d0 83 c4 46 aa 30 f1 44 e2 c2 53 ca 3a 62 48 dc b2 49 48ae bc 93 9e 0b ee cc 0a de a2 16 fd b0 c3 f4 8e 83 e3 2e c6f7 8d 07 7a 98 7c 36 5b 81 87 83 0d 37 30 0e 3b f6 1c 99 cf66 d5 c4 fc d8 81 5d f1 a6 13 04 1f ed 6d 96 6d 57 9b 8c 2e81 d3 86 85 f3 71 da fa b8 e3 38 42 c5 52 6d cb 4d 85 5a e70a 2d cf d8 b2 ac 0b 71 56 3f 28 87 d4 23 13 3d 57 44 0c b928 00 fb eb fe 73 df ac c5 2a a1 62 f7 80 f1 b8 7f fe 54 6abd ac 76 b4 2b ab 68 79 36 be 1f d8 10 46 d2 01 2e de 59 b76e bf e1 d8 a9 7d d9 57 e4 de eb b0 9b 56 36 4f e4 d8 7a d172 b3 1b 74 03 9e 23 0d 41 65 3e 9d 04 67 b1 8e 73 21 25 6f6b 28 35 ca 85 25 d2 45 62 cb 4d cb e1 89 1c 02 31 b2 99 c512 db fa 49 6b d4 65 3a 43 a1 7d 6e 66 4e bb 8d c8 45 5f a45f 21 88 6b ea 8c 03 8e 47 03 dc 3a 95 d2 24 f4 d7 1c 94 f9ad ea d8 f5 f1 51 f6 59 44 cb aa a0 d6 fc cc c1 7b 51 a6 dac3 4a 24 52 9d 32 93 f8 d7 94 6b 21 05 e6 0f 88 cd 98 a2 021e 15 a4 67 25 5f f2 b6 c5 81 99 94 d1 34 94 d2 36 c7 15 0401 33 c7 6a 9d 7b ed cb 1d 67 21 a1 6d 9e ad 25 72 61 01 9e56 c9 65 4c ae 6c db 0c cc d1 53 1c c6 31 f9 76 00 76 16 294e c6 38 07 55 42 65 25 eb 19 69 7c cd ec a9 e5 82 af 7a 45b9 aa 36 c7 a7 18 5d 71 fa f8 60 c6 df 21 7e 32 c0 9b 41 44ab 00 d8 9d 6c 9e 6c 83 d7 63 76 77 19 b2 ae 13 57 c3 17 dd70 6e d6 23 e4 ed ad 4a d5 09 43 be c3 9d 6f 4b b2 5b 0b 224a 2e 04 0d 40 08 1f f0 75 64 c1 ea c2 c8 00 9d 6e a6 1c c327 6b dc c1 7f 3f c0 19 5a e2 b2 73 89 9d 3f 8b 28 b6 be 0ed2 5d d6 6a 14 64 19 96 4d 19 4f c0 37 8a 65 0b a6 2c 90 cb56 a7 ab 9e a2 bb 5e 0a d0 c3 4c 8a cc d5 b2 b9 03 6c 09 280e ae 22 c5 30 a2 73 e4 d9 48 e0 75 25 89 e5 27 ef 76 28 2a71 57 85 e3 8d fc 87 01 90 7e dc 21 31 8c e3 e6 d7 32 bb decf 3b 4f 6f 4a 6b fb 74 a0 96 9c 34 da 37 8b f2 5e e4 3f ff74 e0 71 f7 ca da 1c 68 bd b6 ff e1 2b a3 01 f7 21 da fa 88f3 af 32 c7 4b 96 59 02 38 22 5a df 1e 82 5f ff d6 cd b6 ffab 8c 67 dc 29 2f 1e 1f 8d b4 d1 f5 e0 4e 55 8e bb fb d9 9435 e4 03 92 0d 9e 7f d8 bb 96 5e 39 8e 2a 7c c7 84 c4 71 6cae 13 07 cb 56 08 24 21 89 93 38 f6 75 12 3b 8a ec 04 9c 008e 13 19 81 04 01 81 80 d1 3c fa ce b4 3d 33 3d 9a c7 b5 af57 48 ec 00 c1 82 55 76 41 c0 96 ff 80 90 d8 21 24 c4 02 b182 1d 2b f6 ec 38 f5 e8 ae 53 d5 a7 ba 4e f5 c3 2b 16 b6 eed4 4c 55 75 d7 e3 d4 79 7c e7 2b ca 12 eb 6a f7 fc 28 fc 7494 cd 6a 02 2d 1d 5b b4 2f 98 fa e0 7b 03 b7 1b 78 28 f6 d6db f9 5c 08 26 21 9d 26 e0 42 9b f7 ce 52 3f 83 b3 61 9c 381e c0 8b 96 07 af f8 ed c5 52 93 a4 ff ef 32 bb b6 e5 fd fbe3 91 dc e7 0e ff 89 7f e0 fd 53 55 84 1b 5d be 00 47 63 86f6 b4 f9 1b 67 02 68 ec 65 ba d8 88 a9 cf 5b e1 38 e0 8d e70c ad 49 ec 4e ab 37 d7 bb f2 a3 69 26 6e 8f 88 8d 6b 2d c18e c5 f8 db e1 87 93 a1 6c 75 d6 b7 0b a5 18 85 fb 56 48 a0ec 5e 3a 4e ef db 68 50 05 03 75 be 6e 82 05 3d 3b 2d 90 474e 83 38 8e 68 36 e0 e0 20 4b c7 fd 83 74 a8 8e 3c ec a6 373f 5a 95 dd f4 af 7a b6 99 d3 1e b9 45 5f 67 d6 b5 36 e8 6f3e 8d dd f3 67 c4 06 dd 75 1f 3e 14 90 d5 d1 b1 58 6f 91 b4fe f2 ca 52 51 24 4e 4a e9 ff 85 65 95 48 b4 97 b4 24 20 f0b6 81 20 cf 22 b2 a7 bc 11 f0 51 8f 39 e8 eb 42 01 18 a6 107f 10 0f 38 ae 71 f8 7f c1 f3 4a 12 9c 08 9e 2b fe 2e d1 4a75 92 2c 44 3d f9 49 79 ce 84 ff 8b 71 fe 07 82 02 ed 8a 35c2 bb e8 a0 94 e2 4d 79 0b a7 c4 c1 95 08 bc 59 bb 42 e9 abd5 3b 01 1d 1a 46 9d 6d 25 e4 72 89 b1 5e 8d 5f a1 d2 02 26d7 55 c8 ab b0 f3 1c d1 9c 81 bd 8f e2 f6 a3 7c af a1 30 3d19 d3 48 81 6a f9 5d a1 b0 fb 0d ce 9e 77 95 bc 26 8a 1d 0a9e 04 1c 25 1a dc df c0 8d 7c 2b fc 72 26 7f 05 bd 1f 2a acf3 8a c7 c5 c7 22 a7 e5 5c f5 5b 4a 25 71 d8 28 42 f8 72 c532 cc 0d b5 26 c1 d5 2a 00 e7 5d 71 be 8d 1b 03 38 3f aa 1e24 d7 22 32 82 a4 53 5b 8d 01 24 ef 26 98 5c 42 42 65 43 b1d3 fb 83 d5 1c 9c b0 65 0c d5 3c 99 6d e4 8a 70 34 a7 17 08c8 13 6e 8a 54 99 ce 87 2a 59 ba d2 bf 0a a4 d4 8f d5 1f bd87 1e 93 6b 53 c1 a4 76 e5 df 06 23 75 c2 72 59 1f 53 ab 5fa2 a3 5e af 58 65 05 78 a4 8d a8 f4 2b 9c 8e 9a ec 97 db e165 e3 d7 d2 ad 9c ad 07 a3 ac 7f a7 ee e6 eb d8 d2 0a 9c 0f4a d1 1b 81 a0 8d 01 02 3b 3a 22 71 84 0f 57 c9 5d 78 7c 081c 6d 67 e3 55 16 ab 52 4b b0 95 46 f1 ec 7c 2f bc 14 2a 2c59 d7 3b 55 6f 74 4f d9 b2 4d 36 85 33 f6 90 23 65 06 bf 12a8 25 e1 d8 e6 5a 67 2f fb 9c 20 a8 31 52 ce ec 71 2a 5a b2e6 af 16 6c ea 25 61 97 1d 87 5f 2f 37 f9 33 33 72 5e 56 123f d8 54 6d 3a 1f ee a8 50 13 23 0f 00 51 8f 13 00 d6 90 bdd8 78 a9 ec 03 8c b0 f5 ce 55 6a 82 c1 be 03 b9 03 41 6c 992e 90 dc 1b cd b6 eb 14 e4 a1 94 fc b9 91 b9 ee ed 05 ea 2e0e ed 1a ce 9a f9 8a 67 ea 79 bd 93 ab e9 83 66 4d 5a eb ec27 c7 f2 14 05 f8 ef dd df ee ec 1c ed dd 50 bf 17 ad cd 61e5 a0 d1 4e 87 7d f3 5d 01 00 e8 6f 92 f9 52 89 c4 a2 04 beef 7d e8 6b 67 0d db 52 e8 50 11 6d dd f4 b6 b5 c8 e0 40 69a5 a5 a5 08 88 45 b4 f4 be af a5 4d 3a 8e 6a c8 3b e0 07 c9bd 56 1e 08 34 d7 71 4c 43 b7 fc 0d 1d 0a d0 36 08 fd 88 d6be 56 7d b6 49 4f 48 87 29 93 d2 44 c9 dd 2d 58 12 e4 ad f870 20 a3 c1 7c b9 2f d6 84 f8 ae 36 20 e4 29 b4 c2 a4 06 3b1b 1c 14 e8 5d be 7a fb 3c a1 a9 a2 96 48 39 f1 4a a0 8e 2508 7e f1 08 52 6e af 3f 23 0e 9c c7 f0 a3 7e 33 2c a6 69 e05f f3 00 49 29 46 cf f0 df 9b 2c 11 2b 64 53 a4 7f 34 09 d0a3 24 92 3d cf 72 2a 87 b6 61 5e 6b c6 b6 19 01 12 03 aa 8a0c 90 d4 85 64 15 98 b3 38 04 cb d9 29 f6 2e e9 46 64 93 529f c4 05 8f a3 02 05 3b a2 8c 73 f7 b9 64 e6 51 24 86 1b db33 df 0a 77 41 f3 81 74 e0 4d 21 c0 1f 6e f2 59 ac cb 5d 7620 2a 4a 77 3b 31 9e 4e 22 46 4e 3a d1 41 1a 86 34 87 05 8625 0e 6c e5 3a 84 d0 3b 18 ed ac 28 13 07 d0 60 b6 ee 27 e334 2a 0c 73 c5 a3 61 f9 1a 26 c5 ef b5 d8 46 2c 79 7c 12 ebff 3f 17 e2 f8 8c f7 b5 c2 13 39 82 0d be 3a 6c 73 22 2d 9c97 8c 90 d4 cf 76 61 e4 b8 97 31 b0 fc ae 08 8c ab 77 21 ec38 2b e1 59 cf 24 8a df 92 b3 7e ae aa 82 35 c3 7f 3e aa bd48 ef 98 87 d9 24 f7 c4 af d7 7b 93 6d 6a 19 8d 7b c3 c1 e80e f8 6b b6 60 69 ed 99 56 97 8b 89 68 e2 dd 57 a1 99 23 27ef 80 9c 14 36 5f 06 de 28 a1 7f 9d d2 05 c3 43 53 d6 3b 1798 4b 49 3a 14 05 f7 92 1f 55 3d 5f 18 af 1c 8c 92 eb b1 7e92 28 83 81 41 3b 4d 5a 0d 00 05 fc 34 b7 b7 8b c9 2c 69 e2c7 bf 52 dd 01 81 8a 89 cb 82 f5 a1 61 6e 31 b6 e0 26 23 59a1 5a 0a 91 20 20 8b 48 0e 15 4b b7 3f 5e 0d 26 20 df 9e b0bf 22 04 f6 73 a5 0c 50 54 9f dc a7 2f 55 d6 b0 36 ea df 8e22 59 ac 12 47 4f e8 9d a5 1f f0 2d ee 6a 14 fb 23 1f b5 55bc 4d a1 e9 d7 de 0b 77 17 22 f4 e2 77 1c ca 60 f9 a0 7a c5da e9 da 1d a9 e1 df 0d 0f 88 eb 7b 2c 74 b6 0e 3d 8f 8c a82d b2 53 a2 64 a1 3b 02 08 00 6b 0e 34 b9 a2 c5 a8 cf b3 e1ba f7 79 ff 4f c4 0f 7a 55 c6 a3 39 71 ac 36 c9 9d 75 89 55d3 da 61 7f 7a 18 79 a1 44 1e fa f3 bd 5d f3 b4 b0 e6 ee 27bd 93 a8 20 9b 4c e0 80 c2 25 ab 24 81 df 7c d6 94 8c 40 5ef7 c1 a7 23 64 fe e3 a8 58 a1 40 70 d1 58 40 cd 6d 2f 70 3213 3e 8e 09 e8 0a e3 74 60 29 35 89 f4 7e 90 72 29 59 cd e1b7 a7 dc 32 d8 f6 f8 49 93 03 c9 8d 88 5e 6f 02 53 b9 c1 6d15 fd a2 6a 53 c1 1a b2 e8 7d 06 95 6c d7 77 70 9e fd 7c 3099 0f 20 bc 32 4c f0 cb 2d a7 83 c5 26 9b e3 a6 96 a9 6c eab4 5b 02 4b 69 0b cf fa 04 2e 07 bb 6b 62 8f 16 9c 83 6e d17a ba 9d 89 77 7a 12 15 a5 b3 83 64 25 78 26 71 7b 6b b0 6713 11 6b da 45 65 c2 35 83 1f 4f cf 19 fe 09 ac ad c3 de 0953 00 7e 31 dc d9 01 b8 a4 d2 d1 00 fc 1b b8 16 38 42 47 530c 8f 14 9e 51 11 53 ca 1f e2 a4 fb 15 2e b9 af c6 fb 2c 2e99 0f d3 a4 7f 90 8f c9 49 f7 2b ec cd 91 25 fb c2 07 a0 471b e9 2b 66 f3 49 f0 dc 22 55 4c 9c ca 73 9b 37 df 5f 64 7de1 7c 62 9b 2c d7 3d bb 8e d1 07 b9 8b 6f 34 68 cf da db bfc6 08 b3 eb 7f 17 a7 e7 17 39 2f ce 80 dd 93 9e 04 25 d5 ad92 7a 22 bd e4 92 08 99 41 f0 c7 62 92 c4 e9 ce d2 b7 a5 2b4a e5 b9 14 0f 07 5d 52 ec 61 49 2a 12 c5 1b 42 45 c4 71 63ec 88 b8 55 c9 9a db 7f e4 9a 91 e4 0e 51 f0 5e fd 6b 98 15f9 c4 55 88 8d 22 31 3a d2 6b 95 bb 31 94 e2 c8 60 50 24 d4e6 07 11 d5 0d 64 8f 6a 64 53 6c 7e 94 5c 32 ba ae 2f bf c662 e3 45 ca 5f 9c b1 20 77 80 a5 ec 5d a8 ee 6a 1f 24 eb 4879 fe e3 38 ab a4 1d b0 0f 82 72 43 c1 b4 ca 39 65 1d c6 0b54 12 b3 ec 45 04 0c 18 be 89 72 04 23 f2 c5 55 a0 35 60 5be6 f0 a6 fa 6e 96 6b e5 4a 38 f6 01 13 07 9e fe 45 d3 e0 8722 d0 52 6d 51 f8 3e 0d 7f 2d 60 e3 05 b3 e0 e0 be 40 bb 88f4 f1 4d e4 66 40 35 43 18 34 9d 92 18 ef de 30 f9 88 17 898a a5 14 d2 a6 28 b1 f7 c3 cb 4e 21 5c 4a 64 c7 72 2c a7 f030 87 02 71 cb ef 9d a6 3b f6 91 42 4a 17 ec 62 0b 7a f8 861b e1 d8 a5 a4 0b e6 7b dc 2d 0a d6 d3 0c bc 2d c7 8b cf f0a5 f9 30 cd 90 17 58 92 16 9b 8a 0a 89 75 aa f8 6c d0 58 8f17 65 39 22 cb 34 22 51 59 4f a2 0e 44 32 96 8c 70 ca 42 38cf d2 c5 7c 90 ce 74 f3 67 ec 42 d3 c7 69 fb 8b bc a3 53 76b1 ec 8d 93 d5 ea 82 f4 9a 7b 79 7e 58 eb a8 74 63 79 9d 9d97 1c 5a 55 cd 66 6b 51 e6 45 ba 82 a3 99 84 a9 2c b5 c8 8d55 02 5c fe 80 bb c1 2b 01 73 d6 97 b5 d1 a0 6e 5b 1c 46 002b 34 d7 a1 ce 5d 05 61 d4 5e e4 f8 28 12 96 b4 01 4c 7f 4e87 69 bc 57 86 20 b3 ce 1b ca e3 31 67 c7 ec 47 ec c7 4a 66fe c6 a9 b2 ea 90 33 19 b2 1c 54 16 8e a8 34 99 e2 20 13 e320 ad d0 78 5c 75 ce 1c 06 ea 78 32 62 de cb 00 41 29 e5 d146 1c d6 c8 df a9 58 b4 d4 84 d6 c5 fa 7a 13 9c bf 51 fd 9225 d2 52 b5 8a da e0 6b 27 24 2c 91 6d 8d 94 40 c9 17 54 2881 8a 3d 28 c7 ac f2 67 fd f8 34 a7 1e 2a 27 47 11 00 0a 9d8c 84 70 13 e2 50 6e 8b d3 26 a0 83 16 fa 61 27 02 ab 84 fa6c d7 3c 92 f2 4b f4 21 46 96 81 f9 ad 60 d4 ea 46 72 31 d27c ec 54 b8 f6 72 19 5e f3 2c f4 49 36 1b ab a5 a1 a7 21 8b67 33 52 d3 50 54 c4 a8 66 e5 09 da cf a4 fc 51 0e ea 04 f64e e9 17 e0 d2 81 af 44 93 6a c1 56 a2 9b 95 eb c7 6d 94 816e f6 54 b4 fc 46 ff 29 c0 66 ff cc d3 c2 4f a4 c2 aa 07 313d 99 c2 4b f6 ae 86 67 11 89 8f e6 c6 37 23 82 a7 bd 74 ed06 94 19 3b 88 bc ef 46 e9 80 5d 5e 74 f3 0a 63 44 1a f1 3c57 a1 83 72 bc 4a 83 d4 94 9b d5 62 d2 cf e9 db 9a a8 94 6a41 de 8f 10 97 55 6f 5c a4 e3 d4 d7 64 03 d8 81 f2 4e a9 4f61 cc 50 0f f5 14 d6 26 39 23 0c 64 e2 3a 0a 09 66 8b 57 176c 0d c1 3a d3 be 14 71 7e 10 87 1b ff 4d 3f 37 f5 04 d6 c596 da d9 67 08 06 69 b6 25 f7 96 d9 da 31 05 0b 83 dd f9 4913 29 71 66 5a 58 8a 76 7b 9c 30 77 dd 4b 05 2c 6b 09 e9 9126 14 26 3f f7 f5 3a 97 53 b2 e9 6f d7 a2 eb 6c 31 3b ec c3d8 ae c6 eb 1e 19 1e 5f 0f 66 22 96 a9 7e e3 1c 86 ef 79 c25f ac ee c8 53 f2 66 a3 16 ad e3 f3 93 23 bd 9d 37 1e fa f891 5f 1d fb f8 91 5f 1e db c9 03 e7 3b f2 20 7d 5a 34 20 1b85 c6 ca 23 71 39 62 79 8b 14 6d a8 36 db 8f 54 86 64 6a f725 a2 4a 2e ec 34 4e aa 8d 14 47 02 1b e4 62 f8 9e 2a 41 7d56 3e f4 de b3 f4 4f ad d1 ff ef 11 3d d4 c8 5d c5 c3 ed 89f6 34 62 4f c1 88 1e 93 2a 99 d8 51 10 bd 0b 18 a6 fa 9a 8c78 c3 54 57 e4 42 f3 84 68 15 8f 14 ef 23 a7 f9 58 0d 2d f97c 70 07 dc aa 32 80 21 79 8d d9 e4 e5 be 7b 57 dc 06 c9 297d 83 5b d9 9a e4 df e3 fc 3b b5 b1 4e 96 9e ff fb 81 19 a3c1 7a 4a 32 77 ce 6f c5 ce 33 97 78 a8 07 96 e9 5a 25 16 34dc bc 0d b1 f0 21 63 a1 a7 d9 ca 9c 49 1a 0c 56 94 d5 f6 ede9 26 28 63 d0 a5 d1 55 61 8e b6 bc 0e 2f 12 af ac f3 7b 95b6 37 cc 36 9b 59 3d 7d ef 5a f5 62 f2 99 62 f5 15 4c 86 fa53 97 cf bb de dc d6 25 d2 16 c4 6e d1 79 1a f2 a3 ac a9 8c7d 82 71 5f 79 d0 94 d1 16 79 20 e8 24 b7 69 3a 4e 38 b7 7616 81 e7 da 96 1e 5a 99 48 fb 5a 1e aa 35 32 d8 c0 32 59 adb2 0d 1b eb e4 4d a7 2e 35 49 9e 08 57 f8 d5 ad 33 e1 77 564e f6 51 71 26 3c 41 bc c5 d7 23 96 ae 76 3b 19 01 d4 8a 1f2a 90 71 39 3a 1c 74 8a a0 90 be 58 d9 89 50 05 3e 0a 0f 877d 39 23 1a 8d 8e 1c d2 e7 88 ba f9 19 a4 72 59 5a e6 90 715f 58 45 9d 6b 38 00 51 1c 83 61 a7 2a 52 c9 b2 cf f5 20 8d4e d5 17 55 a8 43 b5 94 3a a2 7a 33 ea 44 63 c1 2b 3f 22 79cb 50 61 59 59 42 ed e6 26 32 6c e0 42 8e 36 c8 4f bc 50 b172 ad cb 08 1a 40 4f 88 03 4d 1e 36 da 41 92 1f ac cb e5 61e4 c9 2e eb 70 2e 6b b5 d6 4c dc 60 b9 ab e5 5a b8 37 2f 410d bf d7 0a c6 19 c6 72 d5 6a 6f 4d 86 41 02 bf 50 8a 6e 1988 4a 5b ca 26 91 71 e1 06 a1 3c 41 c6 8e 2f 86 66 8c b7 a613 a9 39 de 6f 57 bf b9 5f 2b 8d c3 5e 86 d2 6e de 0c 3c 8632 fa e1 50 16 6b 11 9c 0c ab c1 08 d4 ff 41 e4 f8 ea 66 4c7d 2f 20 cc 5c 4a ad 2d 29 91 c7 3c 4b 63 0e 51 e9 94 2d ea71 38 3a 15 1d 66 f3 e8 cf d3 a6 8e 0a 95 8d 93 7d c1 6a d817 1a dd dd 5e 35 47 99 ad 5c be 48 04 c3 ac d6 48 95 f4 d560 2d 4b 13 fd e9 a3 79 fc ec 93 dc 3b f1 a4 fe b9 f0 20 aeb2 db f0 17 98 f5 3d 06 90 c7 71 3c 77 74 6a 07 ac 24 75 c740 24 10 da b9 66 80 49 0f 50 9f 45 08 39 e8 8c bb 4a 2f 05eb 6e 9c 1e 79 75 b1 e8 78 d3 5f 83 93 ac 32 d5 ca 78 a8 ac36 19 a9 56 be 9a d6 d2 f9 8b 95 6a 05 ff 41 e8 d5 7e f8 bdea a9 42 b6 7e ac 59 2b 4f 12 54 5f 4e 1b 97 79 b0 75 2b e94d 8e 7c 69 9d d7 fa 3c f7 75 a3 ac 6d f3 56 55 0c 96 3a 24d7 54 41 64 bc 42 a3 c8 41 d4 c5 de ec 9b 32 ed 9d 73 d9 b373 3c dd 90 bb ef 6a 64 1b d6 3e fc 77 91 3a b3 a3 ee c5 fc14 4e 1d 14 54 4a c9 4a cc 10 ca f8 bb 0b e7 0d fe 3c 12 4089 67 ca e3 8b 6e d2 6f 74 8b 3e 71 d4 97 59 1f a6 10 b7 1613 1f 97 96 a0 2f e9 d4 0c db 52 ba 46 e5 f0 62 6b b6 73 4ffa b7 ab c7 c1 eb 49 ef 94 b0 95 11 81 cf a3 6c b5 0f bc 9be1 3e fc f7 24 34 15 cf a1 bb a5 14 4f 45 ad bb a5 0c 55 0583 63 27 b6 0b 9b 63 87 a3 f7 d4 ba 66 d1 e8 3d 5f 0e cf 52f9 ea c0 5a 93 53 86 ee be 16 bd 35 22 b5 05 37 a5 be fa 462c 74 ab 55 e4 d1 a6 99 15 18 ee f0 3c 3e da ec c2 4a 02 f38c 2f ba 53 3c c1 b5 25 37 27 91 82 f2 74 f9 7b 6c d7 5b c618 66 75 ba d4 97 5d 8c 21 50 72 a0 5d f5 ae c4 e8 a7 78 aec4 89 1c c1 f6 47 5d f9 6f 1a 62 5f f9 8f aa d8 b7 f2 60 226b 11 cc e8 f5 8e e3 44 2c 2a b0 ed 3f 8b 2b b8 7c 3b 38 f788 c4 38 d2 fd 22 cf a0 96 6f 61 08 58 46 20 c7 37 19 ac 83e5 f4 b0 56 fe eb 72 20 1c 86 81 a4 e1 3c c9 bc 4e d2 30 ce33 67 78 06 dc 9b 2a f5 d1 81 4a eb 0c a7 7d df 04 05 80 e5bb d3 3a 72 56 9c 27 2a da f1 a1 a6 26 54 55 04 4a bf 64 6404 0a 31 29 21 f0 0d 62 2c ce c0 a6 e8 67 fb fd ed 62 7c 2846 27 8e 0e e6 82 27 66 ea 36 cb 80 e0 54 54 b6 a4 d4 cf 1ec5 77 87 49 4f c5 b1 ed 5a 6c 6d 51 ad 47 5c f9 a8 4f d0 d10a e2 5e 43 f0 db b1 4f 33 a4 02 38 47 29 71 5d e6 4b de 8e9d 94 d3 fa e7 f7 e5 ea 4d 41 df ec c8 ef ce 03 cd 61 58 603e b8 6a 47 1b 91 e1 d2 33 1c 48 91 dd 2c 55 22 29 d4 af c424 e5 dc e3 2d 60 92 aa 5c 33 45 e2 78 b3 64 46 86 cf 9c 20c2 6a a8 93 07 ee 8f 95 59 02 b5 49 0b aa 24 65 f3 f1 ba 15b1 e4 73 6c 58 db 40 31 06 54 cd 86 4f 6b a0 46 7b 69 a8 8c64 9b 3c ef ba 7e 4e 7a 6d 37 86 be 77 a7 be 29 f0 16 e3 f572 4b a6 66 5e b9 94 a8 36 8c 45 80 f8 19 db 51 65 dc b4 6982 30 38 8c 4b 4f da 29 dc 86 cd 21 01 92 7f fd 7f 0e 09 3e87 44 e8 d6 18 74 61 55 3d f1 c8 55 ce 29 80 73 c7 38 e2 90fa ca c5 12 fa f8 7a 4d 53 a4 4a 7b 21 5c cd 52 66 ff f0 30c2 0e 8a a8 6d ef 79 97 e1 b0 44 70 58 e2 37 a4 e9 0d cb ec86 65 72 43 2f b7 e1 69 f4 05 a2 36 24 98 0d 29 62 c3 12 afa1 4b 6b 48 b0 1a 96 48 0d 1d 4e 43 92 d2 b0 cc 68 58 22 343c ed 16 28 3e 43 82 ce b0 cc 66 58 26 33 24 b9 0c 09 2a 4397 c9 b0 44 64 e8 f2 18 da 34 86 24 8b a1 4b 62 e8 e7 30 2c51 18 96 18 0c fd 04 86 25 fe c2 2a fa 42 f2 92 5b 18 5f 11e7 fa 1f 6f 57 b3 23 39 ad 85 3b dc db cd cc 74 37 c3 8f 98b9 57 5c 34 12 ba 03 23 40 2c 10 08 86 0d 03 62 07 0b 7e 2496 94 5c 29 f7 54 e8 54 39 ca cf 14 cd 33 c0 1b 20 21 b1 60c1 03 f0 06 ec 59 f1 0a 6c d9 b0 27 c7 3f c9 71 e2 94 8f 93d4 2c 5a ea 72 fc 13 3b b6 cf f1 39 9f bf 53 4f 8e 55 5d a798 1c e4 b6 53 5f 50 90 db 6e 59 6b f1 fd 80 17 df 07 3f c820 b7 dd 97 a7 68 ce b5 e5 b7 e3 bd 1e 6f 00 f6 ec dd 46 bf0c 3b d8 59 7a 25 81 61 a6 d9 c0 5d 0a a6 e3 e1 68 33 5e b72e 97 5a df 33 3f 95 41 d7 29 7b 51 42 be 24 7c 51 a7 43 f1c0 92 cb e3 12 6a da 0a 31 ef 21 eb 0f 81 58 aa 1b 1c 25 7016 23 da e1 a1 f0 c6 86 d9 8d ae ca da 37 72 15 09 9f b4 cf77 ae 93 b5 3b 8b f9 0f 3a 56 02 89 ac 3f d0 1b 4d 86 77 2b0e b2 69 f5 0a 5b 3b d1 9f 18 7d 03 5e ff b7 31 c5 ec a6 2ad6 f5 e8 6c 16 f5 d6 9b ae 8a 08 c5 0e 82 e9 03 b3 f3 5b be5d 88 98 db a4 c4 56 fa 7f 3b 85 00 25 a0 1f 21 69 e3 4e 9505 54 2a 12 42 2a e1 c5 4e b6 b4 ba e4 80 48 d0 f9 d1 e6 df79 82 ea 47 a9 48 97 81 79 0b f7 53 45 ce 2d da df 1d db 64b8 de e6 8a bc 7a 72 0b 65 dd 8a 1d 44 13 10 f5 fc ea a7 d7ca 6c b2 2d ac 16 65 fa 92 b3 78 1d bd 84 5e af 16 c1 c5 0e82 ec a9 a3 54 7a b5 58 d7 c2 a1 b0 d8 9a e1 0d 6c 5a 61 5348 e5 ed 35 53 2f b1 87 0c 3b 7f da 12 17 75 97 8b 12 57 af32 63 e5 46 bd 3c 4a d9 70 b6 aa 8d 9b 58 7d 94 1d 41 59 74bd c8 44 0a 9f bb 7e f5 5d b9 5e 68 8b 96 6a e9 36 2a 94 8a1d 30 4b a8 b2 68 14 b5 c9 5b a5 a3 ee 49 9b 95 4e 46 03 52d4 3a d5 76 cb 94 a5 8c 55 16 53 b4 7a 84 5f 55 81 14 30 4bf4 92 ad 52 70 0f e0 5c f5 22 e2 b9 d5 0a a0 77 a5 77 5e 6746 ef fb 35 03 ed 79 91 71 76 59 f4 e7 99 4a ee af 9e 3c 7964 d3 4e ab 04 34 7b 93 58 aa dc 97 f5 1c bb e3 1c d9 0c c878 7b 9f bb a8 b6 7a 68 f5 b7 74 7f 16 6b 94 6f a3 e2 19 83a3 a4 1e 27 f4 60 c9 36 f5 31 d0 3c c0 e1 13 72 7b 68 d0 36d2 4e 3d f3 29 d0 40 68 78 98 9a e1 fd 01 52 03 87 b7 97 7a5b 53 d6 5e 38 8d 14 78 a8 52 50 ae 54 ea 73 a8 00 ec 1b 306b 22 82 6e d2 91 cd 96 6a 72 60 09 4d b0 c8 61 dc cb dc c0c4 17 fa 45 a4 50 5d 06 c1 1a 90 4b d1 1f 1f 48 cf 25 c8 12f0 c6 4d 7c 20 02 e8 1e 90 e4 55 1e 68 6e 7e 5a f6 41 95 5480 93 ff f7 8b 6a e7 8b f6 3b 80 2d 67 82 d2 e8 a8 df 42 1db1 3c e7 29 5d ab 41 c6 14 a5 e0 d4 bb 96 32 0d 7a 48 9b 71d4 bc b0 33 40 af 4b af ef 6f c9 10 d4 84 7a 94 e5 b7 31 85a5 4b f9 3e 61 16 b8 d9 45 e9 ad 0e 61 f4 e8 a0 e5 d0 7e 3a41 cb 1e 27 bd be 36 11 0a ec ea d1 35 dc 75 2c 5c 09 ee 5413 c3 c0 35 0e 36 37 da 40 9e 61 70 86 d6 2c aa fc 99 41 7892 ae 55 fa c0 9b 3d 3d da 61 a8 53 a0 0f 97 fb 62 ff 70 1390 a4 b3 c7 a8 f1 5d 55 a0 72 74 bc 32 00 86 6e ab 22 d8 519d c5 ac 03 d4 1f 96 1d 15 c2 94 3e 79 bc 5b 73 56 9e 65 d526 bb 94 24 72 7c 73 63 c3 53 a1 fe bd be e4 bc 84 f7 2d 4eb5 57 62 57 7f 90 d3 da cc 16 af 95 5a 76 9a 81 91 0d d4 33b1 a2 98 81 1c 0c f4 81 52 79 90 43 ab 83 01 19 eb 74 46 d600 82 6b 6f c8 a7 4f 6f 6f 90 1b e1 4d ea 7c 1f 73 43 ce ed50 74 38 a3 b5 82 a0 c9 12 42 b1 95 d2 a6 a6 cb 7a d1 67 6aef 3e e0 dd 7a f9 53 37 03 96 11 07 0a 46 b1 a4 35 59 e8 4d59 1c aa 16 27 da 27 fb bb dd 55 56 f0 be 3d 05 0e d2 13 5721 26 4d 47 78 56 c7 b3 f1 92 a4 57 19 05 3f d3 63 ed 96 efa5 53 55 8a cc 39 e5 06 43 bf b6 23 32 9b a6 b4 db 4d df da08 b7 e1 0d 8c 7a 14 35 0a dd 8e ae 36 eb 51 8d a0 90 0f 9e6b 02 0f f3 44 c3 19 03 9b 68 37 5b 3c 64 1d 7f 66 ed 4b ac3b cc ea b3 53 5c bb a6 ea be 94 2c bd aa 6d 04 61 00 be fbfb 1c 96 03 4d 38 25 f6 fb 63 2a b2 64 f8 df 4f e0 2b 88 e00b 8d fe b7 b7 a7 9e e1 37 d6 15 51 06 4e 56 29 32 7c 60 3b37 9f f2 a8 65 e1 c0 a4 3b a3 85 8f 0f be d2 46 0d df 4f ba6d 47 5e 51 77 49 46 92 6e 9b aa 3a a4 db f4 10 02 d8 f5 7290 10 02 14 fe 6f 69 37 98 8b 1c c1 e3 e1 d1 7c 0f e3 31 715f 11 04 8d 8b 34 18 f1 82 1e 92 39 98 16 f6 6a d4 e1 18 93ec 13 88 44 9a 1b 86 80 14 1c c9 f7 e0 51 f9 34 a6 fe d0 2a9f 6e 06 56 16 21 de 99 03 e3 f9 18 ae 66 dc dd 3f 52 70 a2e3 f9 8c 91 1c 3c cb cc c4 98 1e bd cc 08 5a d3 10 05 2f bdc1 61 5a 5d d4 3d 04 e3 cf d9 8a 03 d9 58 bd 5f d5 be 83 3587 ed 1c 1b e5 3b 59 23 1a 7c c2 59 ad 53 fc bf 1b 54 83 25f7 7f 3e 41 57 9e d5 b5 a3 e7 dd fd f1 99 a5 9a 2b 28 61 27c6 ce d5 93 21 56 3d 13 4e 91 5c ef 33 72 39 a8 52 5a e6 0c61 1e 25 83 7f 58 dc ac d3 4e 6b cf ca ed a1 ae 87 37 a8 c767 50 92 c2 3d 3e 85 52 ea 0c f8 e7 5a 28 19 69 f2 83 e4 c315 28 80 e2 f3 28 a5 45 27 3e 87 52 0d 34 11 57 26 cf d6 b7ac c6 1a 1c 24 05 99 d0 05 5b 07 1e d3 03 a0 2f 0e ab e2 e3b2 38 7e ec d9 27 f7 91 69 ce 26 55 e4 2c b2 23 b0 f8 04 7773 6a 0e 5b 75 52 4b 6c 0e c9 0e 21 e1 08 42 18 f8 dd 4d b841 af ab 43 03 08 26 40 62 09 e6 62 cb f2 30 76 9c 28 ed 683d 72 02 9f 1c 25 0a dd 95 09 c8 33 f5 a8 3e 14 1e a5 d5 6dd4 ec 06 55 52 29 7a f4 d9 8d cd 55 f2 51 cb 47 75 b4 1e 2fc7 1d 21 d7 f8 61 c9 f4 1d 06 3d ec f2 99 e6 ee f1 68 4c a3fc 63 1a aa 65 3c 63 9e b3 7a 21 aa 74 21 8d ef a1 62 1b 0a82 ec 76 a9 65 83 27 5b 4d f5 30 35 40 44 07 8e b6 0c 10 6403 61 8f 1e 03 31 f1 3b 84 b5 dd 39 27 04 ee 24 4e 87 92 27f8 55 73 2f 3b d0 a8 21 91 11 5f 51 57 f2 fe a0 89 87 33 b422 6b 64 ab 88 5f 34 26 71 4b c9 a5 c2 a5 87 90 86 ee 6a 9d4a fb fd b0 2a 2c ad fd 7b cc 7a fc e0 d5 5f 7e 89 a2 5b 033d 22 30 1f 23 e8 69 a3 6e b5 78 d2 29 d7 46 11 2a d5 09 0415 8f 78 0e 7f 60 69 c4 07 8c 36 47 93 06 17 7e 59 5a 2c f82a 81 31 d8 1b 27 ab 1d 4c dc 00 21 4e d6 40 41 6b ec 7f bb86 e1 a2 df 49 a2 06 ab 1f 74 e7 b5 62 de 18 1e d3 79 09 3e46 10 48 f4 bd 34 53 d5 ef 21 ac c8 e7 fe 97 b3 7d 57 5d e0d9 ac 3e ad fb 84 45 a3 51 36 f3 de 13 f4 5c db 55 ca 40 4810 90 8e 26 f0 16 61 0e d8 37 2a 26 85 1c 79 cd b5 a4 b3 945d 2d be ae 2e f9 52 7c 03 20 70 85 9d 2d 82 a1 e2 6f 0d 2cdd 81 fa 09 74 71 fe 3a ac 9d e0 d7 27 90 ed e4 83 ff c0 4e70 7b a8 73 0e 0c 9b 54 90 76 79 22 71 3c 8b 30 20 61 4b cc77 c7 39 6a db 04 e4 df aa e2 69 e4 ce b0 16 c2 30 a9 da 2372 6f 88 88 bf ad d2 39 92 6f 10 ca 59 a3 f7 53 03 bb 7f 7074 f4 e0 77 79 01 08 f6 4f 70 ed e8 ab 54 98 e4 d5 1e 35 4097 04 2e 82 35 b0 99 4a 85 80 62 ac 05 18 75 96 27 c5 86 e589 c5 a7 d0 7b 32 01 f6 63 57 e5 d3 d2 94 e6 1b be 1e 55 39b9 fc 09 bc ff 2e 7f 7c bb d7 4e 74 d2 db c7 e9 f7 c6 bf 4da0 bd a7 8f 0b f8 cc df 36 3a 20 74 59 da a6 a9 46 52 58 e37a 5c d6 a7 9e f4 ab 4a 44 f3 a3 5e 65 5e d6 1f 8f 09 0c a1ab 3b 14 4e 93 06 e3 a6 fc d9 56 e3 8d dd 62 a0 b1 21 eb a08f 8b dd 07 f4 d2 34 67 33 b0 8b 78 90 cb 31 db ae d2 80 0330 a2 c4 51 5b 9a d8 f2 2b 70 9b ba a8 eb 9a ee 98 7f e8 5d90 76 48 53 4c 6f 9a 2f fb ba a2 dc e3 f4 ce 68 40 5c 12 5f4a 61 16 0b 46 22 c0 32 98 75 7c 29 12 81 d1 a7 2c 49 0b d4ee 10 3d d2 26 ba cc 39 0b 98 79 b2 97 52 5c 51 98 3b 1b 0693 56 dc cc c7 69 e2 09 0f e0 02 fe 3d 26 e5 9f 40 3d a8 03db 07 4e 64 04 ba f4 04 62 85 7b e2 73 41 4a 5e ea 97 e9 726b 04 8a f0 30 1a 49 8d af 9a f5 60 e2 c1 f2 f7 e2 4a d0 3be8 20 27 f9 88 30 1f 4a 61 a9 65 53 e4 20 9a 25 a8 0c 44 ae4c f9 a3 a4 84 dd ff 05 3b fd 22 d9 ca f8 90 8b 38 29 af 3a0a f4 1d 4b 11 86 f0 92 a6 16 a7 de 7c 77 38 bb a5 2e 7f 77dd a8 cb 06 64 1d 5d 37 39 57 91 47 68 ca f8 bc a3 28 6d 6549 29 31 09 51 b1 07 cd 07 07 76 de 79 62 6b 1d da 6d 67 6174 7d 1b cd 40 a0 af 51 1b 0d e1 34 3f 53 28 76 07 a3 b9 3e88 79 ad f8 6e 8b 04 ac d6 0d 67 29 e1 1e 9c be 1b bb 14 6cd4 3d 38 42 48 01 43 a4 85 75 f2 29 ea fc 2b 8e 3e 49 7f d145 9a 6c 4b 38 84 c0 35 88 90 3b 6b f2 53 c8 d2 72 b2 89 6591 00 6f 0b c5 23 d9 fa 0a 27 99 72 3e f4 b7 d4 c4 48 40 6783 71 eb 7c 2f bd eb e0 19 11 0a 8c 69 83 0e 8b c4 5a e7 4160 91 8e 03 83 d4 3a 1b 16 82 a2 e4 7b 3c b0 c7 2e d9 6a 95d5 86 a3 5d fa ec ba 81 53 9b 0c f2 75 c0 5f 6b 12 7c 54 e27a 65 ce 16 6e 80 f0 21 9c c8 49 cb b3 34 da 59 d1 d6 12 4441 68 98 58 0c 6a 77 2e 02 40 c7 c6 28 b7 dc a2 7a c8 f4 1d05 f5 6f cc c2 31 ee 4d 41 d7 27 de 2f d6 27 d3 0b 22 6f 7a7b 7b 6d c9 52 d0 82 00 64 c4 cb 99 62 f5 58 75 06 c5 ea b14b da 71 de ad 58 3d 47 47 47 f7 a2 63 96 65 29 8f ce ed 457a ac 4e 8a d7 32 91 5f c6 6b 91 45 37 35 9c a6 49 38 33 5830 59 fc 16 df c6 40 a3 05 53 0a a7 ff 2b 16 ab e8 a4 60 e946 6c a3 f3 32 17 59 12 b3 74 01 dc 57 d1 8d ac ba b8 50 3c58 d1 0d 83 d6 11 ab e8 5c ff af 4b 9d 48 cc 3a 8f 4e f5 15bc 34 89 79 f4 ef 25 e7 17 d1 a9 ce 29 7f 3c 69 90 3e 4f 7590 3f 67 b9 28 4b be 5d 5c a4 1c 5a 52 2c 5a 0b 7e c5 a3 9358 05 58 3d c9 44 c9 4a 11 9d 2d 99 ea a3 fc f5 74 26 92 426c 45 55 98 94 73 03 5f 53 c5 4e cd 0d c1 2c e1 d1 89 0a 82db bc bd fe 79 aa 63 e3 ca 51 3d d9 28 0e 66 93 47 ff 3c 8bd7 22 af 60 67 ae 92 32 ba 66 ee 17 46 e7 e6 3f c0 2a 64 d18d 16 d5 1f dd 2c aa 22 4b e2 04 5e 4e 56 7d 5e ec 38 2f 174b 9e e7 09 2f a2 33 69 5d 31 01 9a cf 20 b8 78 f3 ec 55 c70a e8 c4 d1 9f c6 81 ea c0 00 75 03 55 6b 98 e1 5c f8 f8 1707 b6 1b 1d a9 67 f4 79 95 4e 26 ba be ca d6 2c 60 27 6b d0e0 f7 fc 5f 63 4a ec 58 c2 89 bb 17 5a 31 0c 65 36 10 36 1199 a0 10 c1 5b 95 a6 05 ac bc 40 bf ce dd 01 ff 8c a9 cf b93f be e6 2b 64 6d 8d 3f 1e 63 8f ce 5f 70 44 bd d6 bc 2e e1ac d2 77 f0 d2 87 b0 e7 c2 a5 44 0d 41 d6 b6 91 36 35 02 afab e5 46 c0 9c fd 87 70 24 10 c8 b9 95 75 7b 7c e0 f0 4f 091f d2 40 14 fe 69 ef 5b 83 e4 b8 ae f3 66 16 20 00 02 58 6001 8a 14 29 91 12 f8 86 f8 02 09 12 24 f8 90 44 da 24 f8 a628 59 94 c0 e7 a0 67 a7 77 67 b4 33 d3 93 9e 99 7d a0 5c 11cb 91 65 2a e5 10 60 a8 a4 a4 44 49 e8 d8 56 68 2a b2 60 2a52 29 56 c5 81 5d 51 45 95 54 b9 28 27 56 31 62 59 a1 44 472f 5b 65 3a a5 92 45 46 b2 72 5f dd 7d ba ef b9 f7 9e db ddcb 1f 2e ff 20 b1 33 d3 7d fb f6 7d 9c 7b ce 77 ce f9 ce fa3a 2c 08 91 47 06 6e 8b 37 08 d7 74 e4 41 26 ca 62 09 3e c144 49 bc 10 b9 2b 11 7d c3 68 a2 c0 7b 7a e3 49 a1 24 e3 1eca a5 d9 04 4b f5 e9 fe 2e de 5c 69 c1 96 29 2d 05 fc 9f 0f7a ac 18 ad e0 31 88 5e ac b2 88 c5 47 10 12 78 c8 b5 48 b472 aa f5 a2 57 aa 72 15 7f 0a b7 f3 6f 72 0f 11 ac 36 59 2bc8 4c 70 4f 17 59 37 de 08 78 f1 bd 1e ab 66 5d 3d 38 14 94b7 54 a8 70 86 f2 3a d8 21 92 7a e6 b5 6d fb bb 3d c6 76 3df0 25 47 a2 b1 ac d6 5f 9e f8 49 ac 28 ad 11 4a b5 ce 34 5c85 fe 30 e0 6b 44 a4 a9 8c c7 56 7c 1b 20 05 c8 73 2d 26 ac1b 04 b2 58 4f b8 59 98 25 22 f5 6a dc 9a 44 0a 78 36 73 8b01 5e f8 f2 d6 09 21 3a 56 46 14 6b c9 b9 8b 71 90 80 3e a91b 9e de 8f b7 74 91 24 5d d9 26 e6 79 56 af 6c ad 9f 83 ea6c aa 84 de e1 32 ab 5c 05 02 6b bf 55 90 ad fa 4e 30 25 0e24 c1 1a 20 6b 60 ca 9b ea 50 12 07 8a 71 b3 39 07 8d 54 71a2 b1 68 ad 90 20 ff 0e a4 45 58 d8 a4 6a 89 29 44 ba 22 8956 4a 59 1e 78 f2 0c e4 b2 ae 1c a5 e8 65 de 44 4d 6e 28 02d3 60 92 16 55 da ea 20 24 45 25 21 02 81 37 ef 47 c1 ae 20d4 26 49 c8 e4 6a 55 7f c8 39 51 d1 6a af d3 3b 6a e4 11 285c 53 05 18 3f ab 9b e6 54 14 1a c4 9c f4 b9 70 12 40 96 5ebb 22 74 1d 75 a4 52 4b d4 37 05 1c bc 78 61 90 89 c5 00 4b51 29 c0 62 80 5a 65 ca 41 1a 6e 0a 59 5d e5 6f b1 9e a2 82d5 ab cc 9a 20 d7 ab 04 b7 e4 c0 9e ff 00 49 df de 2d 08 634e e5 09 d4 b2 83 40 ad 02 79 34 61 d0 e1 3b 25 8c 79 7d b974 6a b2 ba e4 d4 ec 1b 13 dd 0d 78 80 b4 0b b4 47 a0 af 7d5b f9 e6 f2 f8 d7 0c 18 92 5b 78 71 bc 99 dd fa 3d 5b e7 a3c1 28 88 79 51 09 ac 5e 5e 56 39 37 88 ad 81 42 28 f1 4b 7277 21 e2 f9 91 92 fb 05 0a 94 75 cc d0 42 8e dd 42 0c 80 b820 88 2b 68 7a 0e 22 8c 85 69 3c 0c 7c f2 8f 35 c0 f1 22 cb5c 2a da 8b f2 fe 00 82 97 ae 74 84 74 3e 28 db 54 3d 60 be1b c4 3c 46 93 de 6e 8a cf 3b 74 11 13 c2 51 4a 17 b9 d8 360b ca 78 2d 3f 0d f6 c2 fe dd a8 02 1d 2b 81 39 47 4b a0 f47c 1a 70 70 7b 71 7d 6b c5 84 d7 1d 38 a5 14 bf 43 30 9f 1299 01 3a da 63 24 57 6d 14 4e a1 73 0d ce 63 7e 2d 7a ce 5c6c bb 21 77 92 fc a7 0d f2 24 69 be 33 eb cc 24 5c e5 a7 d278 df e2 b4 97 cb 5a dc d7 0e e6 97 16 e3 68 3a ec 8c f7 01b6 d6 e1 22 6f e2 e6 af f2 a3 79 76 3e 1a 8e a7 83 b0 d3 eaf1 3a ad 36 3b 27 8d fb f6 cc 08 cf 43 c7 84 e5 ac d1 b5 7b0a 5f 98 34 40 31 0f 26 51 2e 9d 83 fe 34 dd cd 62 2b 4e aa64 7d 1d e9 03 b6 c7 24 15 18 6b 78 0c a2 d0 16 a9 e8 85 cfa8 6c 04 de 8d a6 23 45 ca 32 21 ff 4c 9a 46 75 e5 c2 07 bd4d c3 77 52 63 aa c6 80 1e 82 d1 22 8f c2 7a ad 4a 87 13 4745 9d f4 fc 09 c5 f3 91 88 04 67 9c 49 64 bf 21 20 fe 7d 1ecb 20 55 a5 44 c7 6a cd 79 23 78 a0 72 6b 18 c0 8c eb ae 869f 8f c8 81 4c bb 91 1c 56 e5 15 1c 4a a8 6a 52 70 b9 24 2da0 4d 05 57 08 54 79 dd 8f 10 47 8c f1 0e 96 d2 62 3b 84 cd94 58 6a 98 c3 32 af a5 55 76 59 1a e9 4c 0e 78 6c aa ec 36cf 35 04 9e 67 ae c2 b2 62 59 99 45 38 98 12 fa aa 47 ce ba58 74 b8 62 d5 5a 88 83 81 2f 41 5a e2 51 a1 83 5a 79 40 8afe 38 49 0d 5a 68 03 3b fe 35 93 a9 5a 34 1b 12 5b 26 05 cb7c bf 42 74 82 83 95 c9 cb 1a d3 ac f9 cb 29 3b 50 28 7a 2565 95 23 de 41 85 56 57 20 45 bb 8a f0 06 65 17 52 d1 9c 7458 f8 d2 c1 52 93 85 4f 09 58 4e ce 91 2a 34 6c 00 49 00 fc9d 2b 11 2f 0a d6 19 b7 04 f1 97 88 b3 43 c3 f4 a2 7e ab 1d4e c6 c5 e4 b0 2b 0d 50 23 d2 2e 6a 42 5e eb 71 7f ce a2 7cf6 54 c8 5a 73 58 c0 b5 e9 4d 4d 02 35 8c 45 47 d6 7f 2a 75ca e0 45 49 1d 31 0f 22 09 2f 5e 1b 4f 02 5f ce 51 59 5a 395c 0b 21 aa 23 d1 f4 90 93 e2 8a eb 65 40 26 ac b3 28 af 5888 78 d1 44 a5 fb 36 dd 28 7a b1 45 02 17 91 e1 c6 dc ac feeb 94 bd f5 64 92 14 b8 43 dc 91 c6 92 36 51 c6 da 95 6e 24c7 23 29 bf dc 1a 7a 2e 64 13 69 2d da b2 17 69 2d de 82 b698 33 e2 95 3b 04 c0 21 c8 ea 93 5b 6c e4 bb 54 27 c3 79 3652 5d f4 8d f6 5a ef c0 69 77 85 f7 e4 24 7f 83 4d e2 b2 4ef3 52 82 7c 4b ac 9a ca 56 11 21 4a 16 ee f7 92 96 af 23 8d48 c5 68 d7 16 53 44 0a 25 2c 45 9c 09 42 09 dd 72 29 8c 2549 6f 69 b9 e4 70 34 66 a7 5c 69 36 6d 82 4d a6 14 91 2a 27a9 23 c2 d1 14 8b 50 6f 84 63 c6 14 49 78 e9 ac aa 6d e9 8005 e0 6f 02 e1 f9 a3 35 d9 ad 60 d2 12 b5 f8 9b 17 b9 2e 1bc9 44 19 22 d9 52 b1 7d 54 4e 5d 43 be 3b 27 b3 7e 7b 33 94ba 5b b8 cc da a5 bf 10 c1 4c c6 c8 95 e8 83 8c 52 27 ed c386 71 12 f7 06 2d 5e 83 bf 15 0c d7 64 b0 5b 6b 14 4c 04 e13d f5 14 30 53 ab 1b db 46 c7 fc 5d 25 da c9 8d fe df 9c 0a4e 8c 5b 7e ab d1 68 ee be 5d 5e ce 9b e0 c8 7e f6 46 ed a83f 69 65 3f b6 b2 92 81 e1 60 24 a1 b5 f4 9b b8 37 b8 c3 d4ce 7c 14 8c 7d 1a 32 76 a8 33 1d 86 1e ed 1c 32 b5 13 ae 8575 74 87 17 a7 a9 a3 9d 6e e4 35 3c 77 9a da 89 83 de 38 8ceb 18 a0 b8 d7 ae a3 43 e3 70 38 89 d7 6a 69 a9 1b 8c bc 5eed 2e 63 4b bd be 88 be ab 61 5d 8f 87 d1 b4 96 0d 32 1e f18a 40 35 ac a4 49 af 53 cb 06 59 0e 57 eb e8 ce 4a 10 77 3cda b9 c7 dc ce 1a a7 4a f1 5a 00 e6 4e f5 fa 3e 9d 6a 3a 5841 44 cc fb 3a 6a 1d 02 ac 12 0f e1 4a 87 2d 51 47 7a d7 cac3 6b ae 4a 68 d5 f0 16 5a 59 5d df b4 03 ad ac ae e3 25 6459 3a 3b 5d 1a 6a 83 24 e5 12 09 e8 6a 12 73 5c 1d bf 07 9634 88 dd 4b 6a 98 68 91 7d c2 4b 22 b0 4b 6b d2 26 08 c8 534d 11 92 36 91 9b f2 5a 5d 0a 21 3c 93 14 80 d9 9c 74 54 833d a6 a3 45 51 1b 46 f6 d5 16 a1 98 ef d2 45 48 97 72 6d a12f 72 99 f3 ae dc 9b fc c7 5c 29 1b 11 91 38 2b a1 e0 a4 2633 25 75 11 27 29 af 9d 61 82 90 38 8a c0 6a 59 87 6a f4 4b47 1e 5d 29 32 e7 e3 61 41 3a bf 7e b9 6e be ad 8b fb 9d 9230 0c 17 86 ce cb 13 38 2b 5c a1 33 95 95 44 c0 d8 dc 72 0f19 fa 24 65 6c 17 8d 0f a3 95 76 d0 ef 13 e2 1e b9 79 5f 36ec e2 7c 7b c7 83 e1 72 af 94 3b 57 3a 8b 1d 63 af 9c 23 15fc 17 ae ba 18 e2 d0 ac d0 fe 1d 8e 79 cd d5 b3 5a 97 fc 6582 27 23 03 22 2a e0 2f ef b2 bf 69 5a fd a1 c6 b4 3a 0a e916 27 42 ab 37 d4 85 c0 31 a0 cb 2e fa eb e9 71 60 20 4e 1180 eb 41 7f a9 15 0d d5 2b 89 dd 2e 2d fc 7c b1 6b 5f ba f35f 34 e1 e5 a4 c7 a1 07 ec 9d d5 9a cc 9d be 2f c1 d3 f7 96bd fc f4 bd 88 38 12 8e 9d 9e 20 90 a5 51 ce 0f d8 db 2f 04ba be 81 bc a7 0f bb d7 6b 91 95 15 9e b7 45 66 a5 2a 7e 378d a5 89 90 98 8b 27 1a b5 a7 7d e5 17 2c 91 17 29 6a 30 612d 36 4c 54 f0 a3 c0 2b af 47 28 e9 71 18 76 50 ae 0c 10 5db9 9a 7f be e7 64 23 d1 55 0f 51 07 d4 92 d4 55 59 0d c5 2340 7c 94 d1 2c 8b 0b 2c c4 fa 32 bb 0e b9 bb 92 53 2c e5 b95c e1 4c 06 e4 af 84 ba 00 69 d4 55 8e a9 47 f6 22 ff 55 b9de 20 64 b8 84 48 14 75 64 fb 9d 66 d9 61 ed d0 70 fb 51 34f0 14 bc 2a ed f8 d1 6a f2 6d dd e5 ef 5e ab 04 10 f1 d5 5588 a3 2e b7 8f 6b 81 50 df 13 3b 81 d1 ef f7 da 1f 04 75 1ea0 cc 56 b7 cf 74 85 88 50 38 47 e7 ca 2a 93 b7 a1 b3 65 8170 30 a0 4f 05 fd e5 80 87 64 76 c3 b8 43 76 fa 5c 62 72 90c1 d6 08 84 82 a6 3b 73 8a d3 8f a0 63 47 fc b1 69 47 27 1c87 f1 a4 35 5a 8b 83 41 af b3 4d 7d 5c 09 fb fd 9d d1 7c 180c 5b f1 b4 c7 95 e7 7e 07 7e 5e 09 e2 c1 dc 24 0e 7a 7d f179 dc 8a 83 38 dc 0d bf 98 8f 06 9c 0f 50 ca 3c 31 24 7b dd13 e6 cb 87 0b ca f8 7f c0 dd 7a c6 15 65 10 eb 35 af 50 c446 d0 0a cf 27 55 74 53 40 99 fe 40 94 5b 8f 60 0d 61 b5 e17d 8f f5 62 cd 77 02 95 8f 19 5c a1 3f dc 18 1d 4c a7 fe ab62 dd 3a 0a 53 8c 82 de b0 84 15 2b 30 69 57 d3 82 6f c7 bb1a 57 46 b6 73 80 30 40 7a e8 a4 e7 4e 94 88 b4 8d b1 52 4d42 ed 8c 95 2e f5 b6 ba 4e ed 60 ef 11 94 1f ec fd 8f f2 b763 78 54 30 1f 4d 26 81 e7 66 16 8d 64 77 37 7e d1 fd a2 3a67 4a 4a a5 22 2f a1 77 41 7c cc 6e c4 40 3d 61 06 c1 b3 d0b3 75 79 2b a7 40 6f dc e5 7e b7 5c 21 e5 75 48 90 41 0a c02b f9 2c a3 6d c9 08 91 30 2b 16 a4 4c cc e8 d3 ad 56 9f ca11 a9 ca f2 42 20 61 54 16 8b 57 e0 0b b0 54 2e 71 ad 7b 1eeb 54 2a c2 4d 15 e7 e5 d2 89 f0 1a 3c 21 dc 77 45 67 d5 7e00 b7 93 f4 1f cd f3 44 c6 a3 6c b6 7b 61 6b 39 09 e5 74 47e7 e6 55 b0 cb 11 af 11 d6 30 aa bf 5d 4d bd 39 af c2 31 ec6b 46 60 5f 2f 37 1a 9c fc b4 d9 dc ce ef ea a8 db 9a 57 1a76 2d 27 43 56 15 61 12 96 a3 60 6c df 3d db 0a c3 29 92 5914 a9 b2 f2 73 ed 02 5f c9 ac ad 1d e0 1b 76 01 fc d8 8d a492 94 5c bf 12 c5 1d d8 80 64 d8 3a 1d 7c 23 82 1a 85 c3 fd34 f0 6d a2 33 c1 c6 04 bc 77 46 ee 61 29 ed 18 05 fd 86 19c2 5e 5b 45 b3 90 10 1a 31 98 2b e2 9b db a6 a5 8b a0 c6 c7a4 cb 04 16 8f 45 e8 b0 2f 20 a7 79 76 89 88 5a 0e 98 80 6f13 4d 90 5c 9b 5e 26 48 fe ce dc fa fd 2d 18 4f 7d f3 e3 62fd b2 21 99 a4 7d bf ce 2e 6f 54 5d f7 9a 12 3c 08 da f2 3a70 4f 12 48 9f 10 2a 34 7f 9a 67 9d 02 ed 4a f7 93 f3 a0 1bfd 89 39 68 8d c2 c0 ac 15 a7 29 35 83 84 f2 09 06 56 bd 4ae0 b1 e4 6c c2 9a f4 00 5f 2d 04 38 eb 03 be 12 f0 bd c4 0352 3a 18 19 09 f3 2f d2 c9 d7 48 25 4f 28 74 b7 ae 89 f6 089c 9d 33 db 10 9b 37 83 c5 2a 27 cb 66 6a 94 dc de 0e ef 964a 7e 28 ef dd 3a e2 1e 6d 14 48 7d 03 71 56 9b ce 9d 7a b8ab 99 9f 3e 5c e0 68 65 5b ec d7 d2 f4 03 5a 63 14 bf 46 9ee7 b6 3e 5f fc 25 ee 47 27 dd 2c 65 8c 10 ce af 24 8d 58 4e96 e7 4b 88 9c 1e 20 c1 32 ed 49 7c 0e d9 0c 8a 3f f8 f3 926f c8 50 ef 75 06 6d c9 dc 34 aa 74 bd d3 bf 99 9c 06 f6 a79b 01 08 7c f3 f4 81 07 9a cd 37 ab 2b d5 1d 9d e4 4e 6a 141b 08 56 c9 aa 24 d6 1b c0 62 03 95 94 2d 5d 6d 57 3b 64 6782 1e 96 96 9d 04 6e 18 8d a5 08 ec cc 4a d0 b4 66 a3 04 eece 48 e5 21 5c 1d 45 e3 bc 42 02 d4 94 f4 d7 2a aa 8a f0 c363 ed 61 ea 4a 8e 22 b7 0e 42 a2 43 8e 69 37 a4 93 d7 16 ba5d 60 05 6e b9 27 c6 71 c2 ae 33 b7 0d 9d de d1 12 5a b0 7ebc 32 84 72 ae d2 2a 82 fe 87 fa 20 53 82 1b 22 27 2f 4b 8bc3 1b 2b ac 93 ea 4a 96 c3 db 5c 50 76 d7 4d 9f 1d 77 a7 fd25 11 da b5 4a 7f 86 4c e2 55 77 72 96 d4 7e a3 ed 31 98 8652 1d 6f 00 01 0e 41 b7 aa c0 67 44 80 c8 e0 ab f9 53 78 8037 21 a0 2e 8a 60 3b 57 0b d3 77 8e 61 13 0d 94 c6 b8 48 b378 0e 02 c9 c6 26 8a c5 f3 4d 17 e7 b4 ad b7 4a 65 ab 09 a215 68 ec 8a 62 a8 12 66 45 99 62 b0 43 dc cf 47 49 d2 a7 51a4 8d 8c 8d ae e2 f4 44 b8 6f 64 71 48 51 c7 bc ed 1f 4e a26e 14 02 f3 3c e4 ce e4 88 ef c4 9e ae bb 3c 67 cf 3d 84 55b6 fe 7a 2b 42 12 9b 0f 78 ea 84 9e 27 01 8a 83 58 8b 86 bf3d ff a3 74 6a f0 5f b9 df 69 25 28 f2 6d 5c 90 5b d8 bc 4c78 ae 39 74 33 5c e2 b8 27 b7 27 fe 5d 42 5e 2d 8a b7 f1 ddd1 dc cc 63 4c 78 5f 1d f4 27 6f 2d fe dc 0f 96 83 96 2a 1ce8 4e 04 ca 35 46 4e 04 ca df 95 7b 95 7f 9b be ca 33 09 2bca 96 b4 b3 a6 0a bb f9 9a 93 7e 9b 52 de d4 30 dd c4 9e bfb5 37 60 5a f4 b8 d7 ee 87 46 3a cc c2 f2 81 41 85 3d ff 4a5e 85 15 29 77 f6 15 96 9d 9d 02 31 55 dd 9f 04 40 33 01 bd4a 03 9a ce dd 73 56 fe 02 e1 67 e9 c4 c1 62 54 64 eb d9 ab6d 12 ad 31 74 4d 5e 41 b8 2f b7 2a bf 05 e9 13 e4 06 3b 2de1 ea 81 3d 47 f2 2d 95 03 3c 89 9a cf 1c 70 f4 c1 f3 65 9a43 e9 9e e8 8f c3 b9 9c 90 b3 31 27 77 41 5d 31 cf 54 cf dde2 f5 b2 fb 89 3c 1f 0a a4 f0 85 a5 52 05 ed 7c cb 7e 8a c311 1b 6e 9f a3 52 bc 44 9e 7e 19 a3 63 57 d4 79 bc 8a 80 8f7f 26 7f 10 db f2 91 45 d2 59 85 b8 57 24 ac c9 51 d3 87 8744 99 9f 85 96 f3 49 32 ab 73 b5 7d 7c 33 7e 79 4f 72 ab ae44 c4 04 a8 91 8f 72 be a8 32 c2 d2 ae ee f7 3c 18 a8 4c 2c2f 5a 8b 5e 2c 2f fa dd 39 31 f5 c9 53 00 12 79 cb c7 05 cb8b fe 0a 76 aa 30 ea 0b 9a 6a d2 26 0d 79 d5 a4 4d 6f c2 a9c2 c4 eb 1c 96 49 c1 dc b5 3d 1f b3 f3 98 17 d4 22 30 95 6b70 be e7 ae 4b bd 00 3e be 9a 82 65 f7 86 99 b4 fb 2d 92 21a5 9c aa 03 e5 7b a7 7b 30 0c 81 74 cb 3d 1f dd 5c 38 11 f82d 94 70 64 cc c6 55 36 48 e1 97 d2 e9 1d 79 1b f8 02 cb 708b 74 5b 3f f4 5c 7c 04 ac cb 0e 53 87 9f 22 d1 78 e2 5d 3092 03 1a b2 1a d2 95 f6 07 e4 22 fd 3d b3 75 91 64 18 42 c69c 9b 18 b9 f2 de 29 62 27 94 80 3f 9e fb e8 a9 c2 e7 93 c51d 05 6c 62 fe a2 3e b1 c8 89 3e 20 83 fd 08 a9 3a 86 c4 0d39 a6 5a 3e 46 15 84 5b 4f ee 20 f8 bc de a8 7a bd 8e 0a a9ea 6f b1 fe 18 a8 cc ec be be af 5b 55 e6 4e d8 74 4b 2e 82cb 7b d5 ae 27 6c 22 1e 0e 9c 83 a9 45 b9 5d 4f f3 b3 70 37b6 4f 0a 7c 07 49 b9 fe 92 94 07 ce 9a f8 7e 41 78 26 42 4fd0 22 c1 36 c4 ef cb 69 29 bf 01 93 a7 79 10 29 43 0c 84 9622 7b 7d bb 7d c9 c9 d5 9d e5 77 d5 9b 15 89 80 d0 42 9b cf0e 19 f9 b8 8c 1b a2 cc 69 65 c4 27 b4 6d 2e cb d7 57 c0 4e09 76 61 82 4f 54 78 4a c9 e4 1b df 47 1a d5 38 07 25 b7 2908 aa 86 27 1f 44 5a 48 04 57 37 0c 96 d7 5a 2b 21 b7 b9 2a54 af 29 6a 39 84 29 e5 5c 53 d3 58 32 04 7b c8 cd 39 f1 96f2 5e b9 46 1d 7e b6 45 1e 09 4b a9 05 b0 01 7d a7 f4 46 1947 2d 1a e3 3c 65 c1 3c 1a c4 97 97 9e a9 7a 5e 56 7e 12 8260 35 f2 4e cf 05 8b d2 77 3a 1c fe 69 48 56 16 a6 57 6b ce09 e1 40 44 42 40 fd de 1b 0f fe b4 55 2c 51 42 a8 fc 39 7f4b 89 d7 2a 1b 7b 2b 3e 82 17 23 a4 b6 55 4a 02 46 6c 83 cbdc 63 b9 0e f5 9b 5d c0 29 fd 41 b9 18 d6 47 3d 9e a4 93 72a5 78 41 ed da af ad 72 9c 3c 9a ab 45 7c d9 2a a2 8e 7a 632f 4c 32 8f 78 a2 aa 9f 00 ff c2 61 6b 3a 6a 5e 86 fd 9e 7ec7 53 21 02 a6 59 85 9d 1e 97 49 05 45 f1 62 83 c2 97 35 8fea 89 97 bb 6f cb fb e8 b6 02 35 f1 96 55 a1 26 82 37 40 56a7 96 da 2c d3 79 ea 8a f4 a6 04 0d 24 d4 ec 6a 0b 96 0c 85b8 82 f2 a4 32 0a 14 d0 74 6d c2 58 85 1a 96 5f d8 28 62 ca7a ce 8c 7b a6 31 57 59 7c 26 14 35 69 dc 0b 45 4d 6f ca 2dbc 3f da 02 ab 87 08 50 78 4b da 77 5b 14 a8 ca 5c a8 26 131c 44 ae 4c 64 ae ad 67 34 e0 76 f1 91 3f 84 63 fc 77 db 3b23 bd 09 eb dd 25 e0 ee 4a 3b 46 08 ad 50 7a 2c 80 93 81 625b 85 61 21 a7 20 fb 08 05 b5 3e 4a 0a 05 42 31 3d 8d 5f 267d f7 75 65 cf ba cc be 4a 52 45 bd 02 7f 21 5a 39 60 2a c896 c5 74 32 ed b6 b5 14 ae 55 12 2d fb 0c 52 42 7f 0c 2a 640e d0 6f cf 89 9b 13 b9 73 ee 23 5c dc ec 46 de ac 6d 1f 64b3 7e 84 50 bc 55 56 94 8c e6 70 6f 7d 7a 59 69 d1 ba 88 551d 9c cf 82 1d 75 3e 18 8c 16 7a b1 77 b8 2c bf 97 87 62 3534 fa e0 f1 20 ec 4f 84 59 ef 62 1e 76 07 fd 65 6d a1 2b f31d f6 5b 72 ab f1 33 29 38 77 73 12 f4 b7 51 74 12 d1 b7 0432 a6 ca 40 a6 6e 6e e1 c9 e7 35 07 bc 09 b2 c1 9d 94 9a d848 82 6a 19 6e 25 3d 45 d5 21 ce 80 0b dd cb 05 21 74 4a 70b3 f0 44 50 30 08 94 34 ac aa cc 46 bd f7 2b dd 48 78 f8 9921 c1 1e cd fc cb 95 e4 a9 09 18 d6 9e e2 e5 d1 d7 ef d6 94b7 4c 9a 7e 4a 78 f4 f5 d7 22 64 07 eb 8c f9 9e 6a b6 cc 0ebe 91 b2 98 0c 1a 54 a9 07 12 dc 73 6d 21 fc fc c0 6b 59 5688 df 38 08 83 3e 25 ec 2d c9 57 2a 1d f6 d6 f8 ab 53 08 50a7 72 51 cb 65 5d 6c ae 21 14 b6 e4 12 f1 c6 6c 45 1c 3b f1ca d5 9f 40 28 36 45 68 64 3b 0e 83 8e d6 8e 18 e0 15 06 e84e 44 03 df 78 fd e9 13 e5 1d 4b 33 98 bf 48 b4 fb dc 03 7ff8 42 f1 d1 eb 9e f2 3a 63 48 b2 10 3d ba ed 8f bf f7 a5 628f dc b5 48 b5 f1 2b 72 48 f0 b6 9f fc f3 6d ef 3a 81 57 8e9a 72 e6 36 89 79 2f 46 fd 70 d0 dc 21 bf e2 db 83 7f b6 2233 a9 aa 29 b0 2f ad 2b 60 89 89 5e bc b2 65 ff 1d 25 19 9c37 a4 e4 0a 0d f4 29 92 6d 41 3c e5 bb bf 7c c5 41 4f 4c 7b26 85 aa 65 3f ff e1 ab da 4c 5c 5f 6e 6d b0 2d e9 3d e9 bbb3 47 f1 18 53 be 7d 9b db 40 48 a7 b3 30 07 c3 be e5 04 c919 51 47 36 97 0e e2 ed 16 4e d5 1e 59 45 76 ce 64 22 91 b7ff f4 dc 6b 3f 5c 2d b6 4f 80 6d 65 e1 e4 5c f3 85 96 9f fcf3 43 1f d5 5a de 63 da 21 62 49 33 18 5a 5b 95 e2 73 e6 e411 2d 7f e7 1b 7f f9 93 7b 29 82 16 65 97 00 c5 d4 53 88 5b7b ec 5b ba 18 8b 84 b8 95 77 e1 a9 ab 1e b8 f1 60 09 1c 587b 0e 84 7b e5 7c 7f f6 e0 91 4b b0 bd bf 90 1a 02 2b 51 dcef 30 0c 8f 4f 73 f3 0c fc fb c6 fb 3c 3a 47 0c 8d 91 9d cf7e 4c 65 55 89 f5 83 c0 fe 33 3a 9a 2f 65 ff ff 5d ba a3 f804 42 54 a7 1e a8 c2 77 77 b1 21 3c d2 44 3e f7 e5 2f bf 7a2b 41 fe a9 b3 cc 6c 48 cd 38 0c 2d f1 b4 c1 ce bf 7a 9c 709e 14 60 f0 99 1c ba 2d 56 e6 ca 8d cf cc 15 1b 22 30 7f b0c3 29 c5 83 b5 51 c2 60 5f 21 3d 36 5f 7f e1 09 82 ca 93 84cb b1 19 d8 28 66 59 7d 21 fd b0 0d 41 d9 92 46 6c 21 5a c999 37 3b f5 17 6c d1 65 83 85 8d bd 88 6d d6 5e d5 64 c1 2b35 e4 c3 5d 42 f8 a0 06 2a 11 d2 7f 67 f0 ac 5e 39 00 1f fefa 99 c5 7e ae 13 a9 ea 8c c6 95 2a a5 d2 68 63 b7 d8 03 470a a8 8a aa e7 69 f9 6e 55 e3 c0 17 9f 41 c9 b3 64 50 0e fb6f 10 b5 c7 17 80 a3 36 a9 f1 db d8 99 7d c7 26 eb 68 ee 3c1e 2f b1 d7 67 af d2 98 cb be 3b 1a 2d f6 7b c3 06 08 4e 0efb 1c 53 5a 64 6b 89 a7 06 35 76 81 d7 0a 96 c5 33 c0 ed ed68 71 31 ec c0 a7 8a 82 97 f0 92 ae 7c 02 e8 47 da 36 6c 280e 43 d6 5b 90 fc b8 cc f4 80 de 7c c0 ac 7d f8 ed 20 58 1c04 cc a7 da 0e 61 66 d1 a8 c7 9f c1 66 68 ca 2c 42 d0 ea 78d4 63 2f 03 df 61 9e 3d 67 94 7f 07 5e 7c 21 3f 72 22 ef 0f5e 12 2e 47 4b f9 76 46 dd 60 38 89 06 10 af 11 b4 76 0b 3d11 b9 2f 5e 79 67 ee 19 f3 dd c6 59 c5 87 b6 d2 29 d9 01 066c 3a 5e 82 2f 27 6b df ca 3c 1d d8 05 95 1a dc 38 1d bc 1dd3 23 5b ea a5 e7 8a c3 53 50 cd c2 78 c0 a6 00 66 9b f6 facb 61 bc c0 76 7a 6e 2c 98 ea b9 d6 38 ad 78 2b 77 c7 ce 82c9 0a 57 f3 ab 8a 33 fc c1 ce 76 b8 82 c4 56 ca 59 c5 8b 52f6 40 cc d3 a4 3c 75 42 df 49 b8 f4 c8 2a 11 81 5d 26 15 0916 76 19 ed 79 29 89 8c 10 f9 7b 7e ef eb c7 4b 96 77 c5 cf95 c2 95 42 e2 3d 7f ee 9f 50 20 20 2d 24 5f 3e 06 67 df 91e6 c6 87 2f 7e b5 d8 8b 8a 95 71 08 e3 85 84 47 a7 67 93 ca03 ce 07 41 b9 25 e6 79 83 3d 84 c4 f0 42 ea 9f df c1 4e 50b2 12 e5 27 a7 3d f9 28 72 bf e0 7e 86 1c f0 d4 63 53 66 fc09 4b 49 c1 b5 d5 0c 59 0f 12 24 a5 f3 3a e7 f9 c7 9f 9d 73e0 f0 b9 b8 a8 99 5c 4c 93 18 f6 97 36 fc fa 71 c2 d9 5d b0b8 3d 8c 6d 02 e3 45 b1 48 4c 1a 22 34 23 e9 fa b0 1a 32 52f5 19 3d fd 62 f1 79 8f d8 c7 c3 14 d4 48 f3 f5 f8 2b 84 84c2 19 f8 34 cb fa 18 72 bb 5d f7 c3 2b 49 b5 2f 79 6a da 4c2e 68 5f f4 e3 9b df fa c2 96 e2 33 6e a5 6e ad 22 a1 91 e7e6 02 21 35 ec 24 6f b3 b5 c7 73 c3 63 ae 05 31 43 94 b9 69c0 df fc 9e 1d 57 9f 72 c7 fb 09 07 48 1e 06 24 b8 6b b5 bea2 08 bf 3c 2e bf 7b 64 d5 b7 ec bd 73 af 7e f7 e0 96 ef d5c6 7a 48 43 0a ae a1 6e 3d 08 60 cc 18 28 7a e4 4a bc fa de4f 14 1f ed 88 76 28 94 30 01 2b 89 32 49 45 06 2c d1 8b 43ff f2 9c c3 97 3a 65 94 0c 35 23 4a 29 47 21 c4 f9 2e 83 b236 14 6f 32 a9 5a 3b d3 ef 25 6f 33 a6 43 18 75 2f 44 98 cc9c 6d 90 32 29 10 78 ec c4 a7 2e b8 b2 d8 3d 0f 06 70 00 de64 62 e3 f9 0f 3e b8 87 70 34 08 7f a6 4a a8 4d a4 e8 68 b486 3b 03 c4 4f a2 f5 db 7e f5 fa d1 7d ee 71 c9 61 01 b2 7968 d8 db 57 8f d9 8f e1 95 66 42 58 3f 88 36 24 fc 22 9d 985b 40 cc ac 19 29 33 5f 79 c4 d9 d6 8a 96 8c 12 94 5f cf 1ff5 d4 8e 2f 6c 79 b1 8e 62 02 f2 31 80 29 8b 6f a3 d9 93 3f38 5c 7c bc 89 85 1c ac e6 24 d5 91 79 c2 59 17 76 6e 4f 173b 13 19 60 4b 08 62 6f 29 64 c5 67 c8 eb 9d 6d 10 c9 aa ddd8 95 7e 91 d8 35 72 ee c4 57 8a b2 5c d3 b1 44 db 62 67 0e78 f9 1a 19 b6 d8 d8 0e 9e a8 44 e1 b6 77 3f 91 3d 51 5d 9675 54 d0 99 37 ce c8 37 96 76 e3 b4 fc f7 f2 ad ce cc 7f 9991 2d c8 cb 45 b3 e0 cb bd d8 19 18 b5 39 3c de ca 61 6c cdd9 fc 47 01 a1 6e 3a e3 08 41 97 4f 7d 20 c4 e3 e8 db 7f fda5 23 25 f3 3f fc 95 a0 8b 29 92 a8 1d 76 c8 62 e8 76 62 cf6b b0 ce 6e a7 1e a2 9a 3f a0 e0 44 40 0b f0 48 81 f4 f0 c7f6 10 84 77 f1 b1 89 1e 8f 4b da 6c 06 5e 3a f5 77 5f 76 94a9 11 0b 87 84 c5 31 b7 df 7b 3c 4e 33 1d 4a 04 10 a3 69 12f2 fd 7f f2 db df bf f5 7e 47 7c a7 60 a6 72 07 53 6e 10 c241 5c cc c3 21 c5 73 41 e0 80 50 d3 d6 5a ab 04 e1 0e 1f 6ea4 b6 d7 bc 69 3f 7d e6 e5 62 db d7 1b 04 6e 9e a8 24 f1 bcf0 00 98 84 73 72 43 9e 82 52 9c 17 ef f8 83 4f 8f 72 6c 179a d0 24 17 3a 2d aa 6c f5 02 d4 84 72 92 9a 7b 46 f6 c3 9c41 ec 83 2c 98 ce b9 84 32 44 29 32 fc 13 53 8f 82 fe 78 469c 20 e0 0b b9 1d 3e f2 37 9a 7f ab 74 6e 1b 19 ca 23 00 1672 59 70 19 9a ec b7 18 db 69 98 a5 e9 4a 82 00 e9 04 5e 6c3d 99 9e 09 3a 80 85 77 c9 9e bc bb 35 5a c7 72 a8 b8 35 a855 9f 92 36 cf a3 07 09 24 c0 40 d2 41 56 ba 1a 5c 29 57 d807 19 aa 7d e8 f1 8c 45 91 1c 7b 69 eb 8d 8f db 92 19 94 8386 47 e4 93 1c 34 88 8a 52 74 22 4a 5d af a4 1f 91 9e be 6950 80 b4 20 74 d9 f4 6d bf fa 6c 49 5a 4b ed 09 3a 73 87 147f 7f f6 ff 9e fd 20 41 81 cb 21 1a 68 10 ba 84 3a 72 ab c82b 26 aa 1a 9b 0a ae 2b 2d 2b 50 fe c9 57 5e 7f df b3 6e ab4a 61 26 44 ab 8a e0 3c 9e 8f 02 6e 57 74 7a f1 04 5f a7 0510 f6 6e b2 c4 22 a8 13 26 05 02 a3 1a 23 9c 80 74 9c b2 6a0c 86 83 91 45 42 27 cc a7 b7 c8 47 5a 28 86 72 71 27 39 199c 6f 5f da 90 b7 bd a6 35 ee 38 14 d8 49 30 89 d8 ac 8c ba6b 92 0f d5 80 14 04 a3 64 65 3c 7c d9 aa 1f 61 a0 5b 62 9d77 68 ee 5a c7 18 08 2b c4 a9 d4 1d 3b 71 e4 61 2d 34 03 6164 13 da 05 33 19 63 5e d6 6c 26 49 4f 91 fa ed 6b fb 47 c516 5c a6 19 93 63 7d a4 6e a1 72 6e c9 5f 41 39 43 de d1 dffb ef 9f d7 ac 8c b2 2c 7f f8 f1 a9 e5 b5 8a a1 fe 8b b3 f73c e8 bf d6 8b ea 67 d5 15 5f 3a 6d 1d 3f a6 4c 6e c9 03 84c7 e4 09 e5 b8 c6 23 9f 91 b1 c4 89 ad b5 ed 63 9b 47 84 7d6b 72 21 c9 d5 3e 93 96 c7 50 6b e0 f7 35 07 a7 c3 81 a4 ac1b a5 bf 09 5d 42 7d 95 e8 6a 4f be d2 78 56 43 85 ab 30 98ce 60 c4 a4 f2 b8 6e 6d d7 4e 35 bf 6a 03 24 0b f7 62 47 9349 ae 22 a9 b1 7d c4 95 27 6c 70 8a f0 e2 d0 4d e4 b1 71 f5dc 6f 07 01 3a a6 ae 96 8d 52 23 04 d6 0f a6 1d d5 0a 6e 018d a4 17 99 5d 26 05 ee 97 7f fa c4 f5 65 e4 16 be 9d ed 928b ee 06 c2 f6 1b 2a da 29 84 a0 33 08 cf a7 7c f9 85 36 059e 30 e2 31 10 0c 7f 23 83 ed 08 60 4d 11 2d d9 71 f4 b1 ef15 9f 45 f2 82 72 5a 58 6d 9a 21 ed a7 14 25 ff a2 bf e5 5e8f 65 54 8b 37 74 fd b2 51 f1 75 6d 74 6f ee b5 2c c2 c4 f381 87 40 62 aa 94 c3 42 0d 87 4c f1 11 15 b6 0d 0a 9f 80 ac52 fa 6d 3e 58 9b 7e 3a 3b 77 b7 f7 ec 54 0a 03 41 5e 02 75e1 30 0b 8f e8 b9 01 c7 48 86 fb 4f 82 0e eb 35 3f fe 5a 2901 fa 8e e4 4b f9 d9 75 24 ab 68 14 d6 e0 30 d4 cf 20 71 44ab 4b d2 23 fa bb 6f 7b fd c5 07 cb 9d 19 04 a6 3c b2 16 762d a1 0b 1c 62 ab 16 68 e3 e3 2e 51 62 1b 2a e4 c7 9e 3b 7e83 16 13 e3 97 d2 77 a6 e9 97 37 a2 66 89 b6 22 9c fe 19 627d 7c 79 b8 01 b5 ef 6a 0d ab 72 b0 34 2d c6 61 38 a4 58 d6b3 72 5a f9 d5 3e 48 fd 3a b1 b7 fa 40 3d 04 ef 48 a1 66 715d 21 11 3e 41 df 39 1f 7a 6d 5e 75 c2 f6 06 0e b0 2c cc cbcf 35 56 52 8e c1 08 f7 aa 72 ec 06 c3 59 91 ab 10 41 f4 f883 f2 10 fc 79 c7 6f f9 b5 db cf f4 ad 10 43 38 a5 07 7b fcaa c8 3a 9b e4 01 4d 1f 2c 29 cd 5c e4 53 e4 89 e8 12 56 9ca9 20 1e dc fb ce ba 78 33 c6 72 77 72 9d 7e e4 e3 9a 61 8d84 fe 15 63 29 70 83 07 71 f9 78 72 1b e1 90 5a 36 94 dc a56a 02 a9 12 f7 a8 c9 bf 88 89 66 f0 24 02 c7 0c 5a 5c 15 65eb 23 06 ac 3e 60 3f 75 0a d0 fa 7a f9 34 29 89 91 3a a8 4849 8c b4 d1 27 29 39 40 87 24 98 24 20 04 06 ea 46 1a a5 a337 57 10 cd 52 ea 94 c5 19 f6 51 04 81 4c ad 27 49 cc 63 cf3d f6 fc cb 88 a9 2e 9d 5a 3c 2d 84 b7 1c 47 1d bc a1 82 4fd5 36 81 ca dc f2 98 c0 43 73 8e d0 3e b9 69 a1 7d 90 f9 83c5 cb 3d ff c1 03 3f 29 3e e7 1a ca 99 a3 d4 87 36 3b cb 780d be 05 dc 0a e2 3f cb 35 72 eb cf 5f 7c af c7 9a a8 33 faf5 42 d3 e4 c9 f5 a4 a2 ca 70 f5 0a cb b9 b7 b3 b3 a5 5c 670d 1b 78 a8 96 32 6e 59 23 32 da b7 1a ce 0c e2 79 6a 9a c0e4 9a 18 55 89 32 9a a0 b5 61 ba a1 3a 9e 8b b1 55 b9 0e f8a9 8f 0e e3 5a 39 4f 6c c6 b5 ba 04 18 42 27 b7 dc 4e 6a 95ea 53 54 97 fb 98 3e 36 11 93 d6 ed a2 61 3a c7 6f 3e fb cf4e da 03 93 12 4a b9 74 93 ae 11 03 93 52 2e ba 62 1f 7c f2e5 3b bd 28 36 e6 cb ab 1f e5 42 3c f5 77 5f f6 29 96 35 036b 60 89 8d b3 6b ef 4d 9a 62 97 cf 46 64 cd 2c f7 26 5c 3138 35 f9 ab d3 70 a4 7d f0 8a 0d 33 b9 da 0d e2 61 5b 3e 79c3 e3 25 c6 45 3b 44 e9 b1 25 44 42 23 9d 0c 88 02 e5 60 50a6 27 4e e9 c7 98 43 3a d4 af f1 59 68 49 bf 7c 75 41 8d 9cac 13 2e f4 c3 f9 84 ad ff 4d ea a3 88 01 8b 3e c4 fe 62 8a29 05 c8 47 e3 9d f0 31 35 06 33 bd df be 36 8d da 72 9d f8f3 0d e8 ba 0b fa 0c 94 1b 2a d0 4f 6c 8d 16 cf 0c 4e 36 a48c be 6e 5e 44 bb 8e b4 73 40 d1 50 ae 15 6e 2c 54 01 55 51e1 49 30 6b 5a fe 59 6c a7 ef 6f d4 74 a8 5d e2 7a 58 29 1a56 f8 cc c9 51 ae 23 e1 2a 40 3e f2 e1 43 d4 45 81 e4 cf 2126 6e 21 8d 2e 3f 87 25 d2 ed 28 5a a3 46 36 47 52 ba 44 88da a5 1e 52 c6 77 8f 9a ca 7c 0e a6 e3 6e 1c 89 e0 bd 70 e514 a5 d0 ae f4 25 ee 15 0b 4f a4 bc a0 b1 5b fc 26 c8 6e 92ef c4 d3 3e b3 f8 de 39 74 69 e4 9a 5e f7 a2 f1 be 03 e2 4a18 12 2f 6a 50 8c 76 64 43 91 03 88 1d 89 55 c2 b3 69 80 57a1 9a 2e d5 9e c7 3f 7d f2 3e c2 98 c1 38 40 05 99 9b 48 6c71 70 13 0d 13 f4 2f 72 22 1b 07 45 4f f8 c0 7f ee b5 af 6967 7c 49 a7 00 44 34 eb 77 0a d8 f8 65 ba 12 b7 45 17 01 825e 9d 6f 18 3a 18 ab 8d 37 26 af e0 79 e4 d2 0e 3b e7 57 56f7 7b 88 84 24 ae c0 97 b6 8b e2 f6 87 e8 bf 07 46 8e 2c 238d 81 5d a4 24 95 0c 94 bd 9f 20 90 f1 03 82 1a 2a 2d 3e e7f5 8a 63 27 82 9f ad 02 79 2a 75 9e 79 1e 75 53 e0 b5 68 6ee7 df 76 d4 d7 0d 2f be 1c 90 ea 8b ca 45 d0 67 df 09 a7 d53a 75 63 33 5b f6 df 71 88 b0 76 b4 ed 4b d8 b0 08 3c 60 e3f3 cb 07 8f 10 a9 a0 ec 0c 6c 18 45 a1 69 cb df e6 38 4b 2a46 d8 da 93 5c ae f1 9a 82 44 29 a1 5b 4d 04 9e 5d 13 cd 1e05 45 f5 a1 56 d6 26 24 cf a0 2c 16 fc f3 83 fd 2f ef 25 b489 1f c6 86 06 01 55 8e 28 af dd 5f 63 08 66 73 93 fc d7 5a68 25 45 23 a8 90 a7 c0 23 e8 c9 20 89 ba 9e 03 90 6a 4c 0671 30 1d 8b 5f 7a c6 58 97 5d d3 a1 d0 42 62 b1 40 02 5e ce5b 6c e7 ef 1c 3a 41 f7 fa 21 51 0b 4f be 72 c1 d7 ef 27 a8b8 b9 5d c8 ac d1 b0 bf a1 50 ae d3 25 e4 78 fc a1 6d 7e 551f 7d c8 44 99 4f 02 e8 08 99 45 18 2c 47 bd 4e 6b b9 d7 963d 6e ee 2c 7c 41 2a e0 5c 48 ac 90 9b dd 2b 71 02 65 1f 9b30 4d 7e 85 87 77 74 d8 17 cd ed a2 16 9f fa d4 b0 85 57 a5a1 27 24 b4 9f 0f 36 22 e6 0b 08 56 ca 06 45 c2 af 08 2e 3a60 18 67 b9 4c c0 58 06 9b 27 6f 32 4b 6d 60 f1 87 da 2a a2d4 aa 24 9d af 0e 2b 45 c1 7f 78 2a 14 0a 10 52 ab 24 20 f505 1a e8 aa 6d c7 cc cc e3 a9 ee 41 87 69 3d 51 73 67 e1 8bc6 63 64 59 66 33 e5 21 3b 07 a2 fd 78 50 78 00 d7 86 d4 dc54 72 ba c8 d6 df 38 9b 4f cc df 0a d2 fb b7 c1 94 fa 9d 85bc 77 65 b3 dd f3 3d ad 79 fe 99 4d 43 30 88 d8 81 b2 59 fde1 e1 c2 43 63 db 9f fb fd 8f 6a e1 01 36 31 95 1f 9f 69 bfed 3d 6c 0e e9 ca 03 05 99 91 24 d6 dc c2 34 1e 06 f3 0a 389a f9 1f 5a 3e 2a 8a 87 31 69 32 90 c0 16 c7 e0 c2 d5 f9 fe74 dc 5b 56 24 0a 4c 1f 9a 4c c2 78 38 de 72 97 fc cc af 1e70 74 22 1b 6c 26 d4 b8 0c ce 7e 4f 6d 8a d6 24 1c 88 49 02df b0 df 1b f7 98 da 62 e7 d4 42 4f ac 7f 8f d6 6e 37 b5 3661 62 d2 a7 a1 3b 8c af 38 e2 a1 35 1e 2d 1d 32 b5 b4 1c aed6 f2 6a 6c 89 76 ea 79 b5 61 c4 76 7f 1d af 16 f7 da 3e edd4 5e 48 59 8a e1 7a c2 43 13 4e 39 a8 a7 7b 68 ee a6 bc efc5 a8 df 41 f9 4d b6 c9 22 9b ec e7 30 a1 0a d9 05 be 51 a2ef 34 f0 55 2a 28 77 80 2f 39 7f c9 6e f0 39 e1 34 81 ad 4b91 7a 06 6c 1d 70 a6 ec c8 7d af db 3c b0 57 32 d3 56 1a bb4b 3f 7d fc 74 f0 13 a0 25 f1 ad 88 ea 81 95 39 ce e8 94 e68e 44 39 f1 e3 cf ce dd e3 68 af 90 02 0d c1 51 82 65 6d 449f 29 f9 a7 52 d9 e5 da b3 5b 1d 07 e6 b5 3c 08 05 13 bc b842 c2 39 cd 1d 09 37 bc fc dc 20 04 4f c0 68 d2 62 7a 42 a578 52 10 c8 00 ce a4 95 a8 d5 ee c5 cc 11 c8 87 55 7a b3 4e4d bf 6c b8 22 89 79 70 77 4a f4 52 34 32 c5 af 59 c8 fa 85bf fd 32 d9 d0 d6 f1 04 8a a1 6d 53 d3 85 32 63 b4 50 c5 6704 f6 70 98 d9 49 e4 3e 32 02 c6 b0 fd 07 08 db 34 01 ba 6a8f ac 23 c4 1d 26 0a 37 ea 89 44 15 6e 07 37 b4 00 4d 0c 6e06 15 7c 18 ac c1 58 a6 ce 8b 04 37 91 4f c8 d2 85 f6 0e 32d9 c4 35 af f2 7c 70 b6 58 0d a5 e2 52 b1 11 e1 d2 36 14 8a69 6e ed 0d 46 d1 78 dc 63 82 0d e3 c5 c4 1d 75 c5 9a 17 ebe1 69 72 ac 00 99 7f 2e 00 04 e7 fb 9f f8 eb 23 8f 9b 5c 33e2 54 07 ae 19 f1 19 b8 66 8a 73 97 fd 2e 84 e0 ec b5 d7 3e41 28 b2 ab d7 12 00 9b 4f ab 1e 60 17 c6 8e 8a 03 87 29 0792 82 bf b2 99 5a 87 09 bc 96 22 98 07 55 19 73 2f 76 48 d3a4 64 0d 09 37 a0 88 b2 b5 30 65 4e 95 6d 16 72 b2 79 d2 20c1 0a 54 e8 8c 52 3d b8 d2 48 d2 39 8a 61 86 85 e6 da d1 0afe a2 85 60 53 9b 2f 43 ee 2c 92 60 e1 1b eb 0a f7 04 10 5822 9e 7c 65 d3 7b 35 4c ad ce 22 a9 46 37 41 f1 a1 58 51 5402 c9 b4 2b 95 ba 74 d4 b2 8d 81 47 69 96 e4 a0 6e 82 80 7703 e4 b5 41 4a c0 05 93 29 8f bc 48 18 97 04 ec ee 68 a1 8544 13 6f 65 4b 7d 14 c4 a2 cc c1 6e fd 77 7a 89 67 43 3e 39e2 43 43 09 8a f9 d0 4e 5a 63 b6 f9 37 6f 83 05 16 4f 6d 87e1 24 16 76 da f6 d1 74 30 5a ea f1 6c b6 70 d0 d8 ca cc c548 fd bd 4d c9 6e 76 92 4f 1a a7 a4 e5 cf 9e 7c e5 bf 9c f6ea b6 11 2f 7d c0 7e 1c 45 9d 06 c9 7d 27 8f 2b 9a fb 8e 4cee 56 88 ec aa db 9b 7a 2e 36 a6 ed 80 0d ea bc 88 de 0c 277b 77 aa 54 a9 51 14 2f cd 77 a3 51 63 33 9b 6e 66 d9 0f 1bdb 05 65 62 ab 1d 4d 78 79 c3 59 75 dd 40 38 60 1b b3 e3 1536 03 4c 81 8e e3 5e c8 f0 47 f5 2b 9b 96 85 c6 76 d6 0e 035a d9 2b 4d 7b 93 c6 46 f9 5d 3b 90 4f 99 b0 35 d5 d8 92 3e6d 96 cd 22 b3 c1 03 36 00 bc c2 c3 6c 32 af dc d1 35 6a 9c12 8c 46 bc b4 a2 ac 1d d1 0a 99 94 d8 a4 9a d8 24 33 b5 1a5b d5 93 e7 d9 3c ce 8d a2 1e 33 67 23 f6 6c 75 d5 b6 64 718c 7a ec 56 d5 f7 ad 23 66 64 a9 92 12 db 13 5c 40 3c e8 1451 3e af b1 3d 66 ef cc be 5c 60 67 42 b7 b1 49 24 8c b1 9362 3c 65 fd 98 ef f1 e6 45 d8 d0 f6 45 ce be 91 0c c1 a6 71d0 1f f0 d6 b3 3c e5 c6 36 b5 1a fb bd 79 36 82 89 e5 cf 8db5 49 63 4b f2 aa e9 d0 aa 37 da 91 bc 91 9a 87 33 54 da b6ac 1e 97 75 76 36 1f c4 b4 81 8f c0 36 95 f1 26 be 49 da 551d db a4 1e 8c c4 93 48 ca bd 34 d6 79 83 dd ab 8b a6 f0 5f46 90 08 43 3e 5c d9 36 72 86 dc 12 b8 37 c9 64 1d 5c f3 78c8 be 2d 91 dd b7 7e 5b f3 ba 92 a7 04 8c 0d 2c 84 9f aa 33a0 af c5 06 52 42 51 20 46 53 30 36 aa 20 37 0e cd 51 ba 3082 98 5e 3e e5 02 8b ac ee f4 c6 a3 70 38 46 cc d5 cd 62 4133 88 44 6a b4 fd 2f 51 52 d3 99 f6 04 45 bf aa 57 d2 13 3b31 fd 51 bc e9 e7 fe f7 bc 46 28 7a 85 ad a3 b9 9a e2 34 df2c 77 40 1e b6 8f a6 4e 1a 97 ad 5f ac de 70 d1 ec d0 ae 91fa e7 27 1f 27 c3 b7 1a 3d 35 53 c1 c6 93 bf a7 a7 26 d1 53df 6a 9f 5d 33 81 bf 75 6b ea 04 1b 04 b6 95 94 0a 08 08 838c 1e 08 79 60 f6 a3 5c 33 5f fe 9a 06 61 51 b6 5c 3e 0e 6006 9d 4a 63 2c bb 16 eb bf 10 c5 83 8c ce 64 8b 46 6c f2 1eaf 81 00 60 42 d5 a1 00 39 3d 99 52 2e 3e b7 d4 8c 4b 5d a9c5 fc 8c ac 2f d1 b0 cf ac 2f a6 ad 76 c6 cd 73 f8 d7 e2 5276 89 f6 33 16 b2 94 19 32 0a ed a7 67 38 32 c4 7f bf ff 1891 87 c1 81 3e 25 99 f5 24 e7 04 33 bc de 54 9c 7f 81 bd ed10 df f4 92 38 20 29 4b 7f fe fe 93 04 9f 42 52 1c 8f a4 5f1c f8 e2 33 20 93 5b 84 62 09 a7 02 fb 4b 08 78 1e 60 74 1aa8 38 9b 7e 29 4e ed 7f f2 a7 47 1c a3 21 21 7b 0b 1a ab a3f6 0e 81 02 23 34 54 66 49 02 21 db 04 0a 0a 25 13 d4 bf 623c 36 e1 b0 3f 60 38 66 06 c1 22 1b c9 a0 c0 c8 cd 07 96 0fc2 c6 ed e9 70 70 f5 15 55 57 ed 1a ae 4f d1 6a 94 4e a1 fe28 70 13 4b 40 02 9f 98 92 fd d0 a5 22 d3 df f9 9b db 03 3304 02 4e d7 51 04 06 fe a8 c7 d8 ad 3f c0 bd 50 6e 26 8b 675f fd f3 49 d0 ff 65 16 47 35 e4 d6 91 5b 8c f0 20 54 03 f60a cb cb 9c 74 b5 d2 df 58 7b 1e cf e5 84 97 cd f4 62 39 67e5 a2 21 60 b3 72 cf b9 79 f4 36 7d a5 af 35 fd 36 bd 69 0532 0b 8f ee 06 d1 c4 42 9f d9 1c 6a 46 ef 3c 8e 8a e3 05 1969 d8 70 d7 68 cf 52 90 69 d4 cf 7b 0c 33 98 4a 9a 19 39 e57c 54 07 61 a0 12 8e ce 58 d4 56 e7 c3 be ea df 3a 26 58 9d87 f4 25 0e 57 58 4b fb e6 83 69 bf 13 23 29 06 62 b5 8a b14a d8 e2 c4 9b 9e fe f9 fb 5d 24 10 40 8c 92 24 28 21 1e 24d1 4c 88 a4 43 4c 37 71 68 17 5c 21 99 8f d7 58 83 7d 39 a1b2 bc 6b a8 4e 92 1d 7f dc 2f 95 71 b8 16 94 28 3f ff 36 c392 53 e1 b4 92 fb 56 01 5d 5d 06 0c f2 86 8e df f2 6b 8f 3d51 6c 08 60 05 20 94 59 fd 25 34 42 e6 1a 3b 00 9c b6 1c 9162 0a 67 3f 62 cf 84 e4 d1 dc 1d c9 76 cd ca a4 cb d5 0a b63c 83 de 62 20 06 66 e7 23 ff 6d 2f 28 1e 9b ca a3 85 5e d867 ea 38 a8 58 0b ee b9 f4 ae 3b 80 ae ca 97 6b 2b 9a 0f 8321 2c 43 1b c6 11 77 78 b5 83 0e 9b 47 d6 12 e8 25 db 10 4719 0a 18 f7 96 d9 8e 07 df 2b 7d 59 6c 6f a9 e6 7e e7 ae 4fbc 05 bc dd 74 28 e1 73 be 36 7a c3 b1 ec cc 91 2f ce 81 3694 c7 37 8a 99 55 aa 3a 7b ed c9 5c 81 60 d6 99 95 70 c4 47be df 1f 37 de 0c 6e 0d 06 cc ec 6d 49 1a 15 79 ef fc d7 5f84 f7 46 f9 57 da 0d ef 55 df 81 cb c7 c1 32 d3 76 03 de d949 18 4c 65 8b 9d cb be 0a 6b 49 87 81 e4 63 7d fa ac fb 7eb4 f7 74 30 a6 1c 60 81 6f d1 b9 f2 04 f8 99 cb 8e b5 d6 280c 96 c6 ea e7 15 58 6b 3a 95 91 e3 95 60 30 82 ef 38 1e 0996 7b f8 8e ef fc 9f 47 40 8f c4 a4 c8 4d f7 a6 3f dc 03 daec 4f 97 98 b6 cf ed 51 3e d3 e2 d6 dd 2f fd 83 ae d6 29 8674 c4 39 66 03 b9 26 e5 8c c1 e1 c9 e0 29 5e 5e 59 6d f4 7de7 6f 39 bd 78 ab 58 78 b9 5a d8 c9 02 61 ef fd 4f 0f c3 a2ca e2 75 c1 b3 3f 14 f0 3a da 72 a0 60 4d e6 79 be 21 e4 9205 e5 95 b3 f1 7e f2 95 5f b9 69 15 5c df e7 61 d7 a2 9b b937 e0 0b 1f 34 05 6e 60 78 39 2f 18 bd 14 62 0b 5f 7b 70 2764 98 df 04 2a 1b a2 e9 dc e5 60 1f 64 6b 58 f6 18 36 95 9bd9 7f f6 32 18 1c d9 cc b9 e0 8b 4c 28 28 ba b6 74 8b 3f 7dd6 fb 7f e7 4c 6d 22 c4 6a 85 bd cc 3a a2 d6 3a 1c 82 6c b140 12 03 f1 62 f9 b5 04 d7 a7 da df 70 e5 b7 1a c7 f5 21 844b ff a3 cf e0 2f a5 8b 82 47 ff f6 e4 69 85 ae f0 8d 06 c78f a9 00 1d 09 b3 1e bb ed 91 db e6 ce c3 5e 56 aa a8 0c b390 22 04 d6 0e 97 c3 a0 84 c7 37 9f 85 c5 c2 53 91 c5 c4 da33 4f 10 22 f7 ed c1 58 d8 af 45 85 42 bb 46 2a 61 48 71 6a47 1d 87 5c 54 8a 54 04 3c 6a 24 39 28 6d 8c 65 af 4a 2b f1e2 b3 6a 96 6b f1 0e 05 47 ad 7e 5a 04 08 67 2b 74 e4 24 0acb bd 6a 4e 62 6a fe 17 3b 04 b4 2b 34 c2 9f c9 e0 5c 5c ffee 3a c3 fa eb 8b 9f 37 c6 bd 77 a6 43 af 86 ee 34 76 89 8d4d bc 56 4b 9f da 51 7f 52 4b 43 be 41 fd 75 85 e2 9b 07 a9cb 49 42 ea 79 37 26 be 6a 79 37 a6 b4 d7 b2 26 e7 23 e6 bbf9 3b 90 b4 52 57 aa 49 7d 19 22 c6 57 e3 e7 77 2d 0d 75 23bf a9 33 2e f0 38 60 ee 67 af 79 23 84 24 aa f0 6a 6f cb 9060 19 67 ba 3b 01 b5 17 09 cd 8e d3 2d 21 3e 34 e7 31 16 090f f7 db 1b 4c dc 30 84 80 3d b4 4e cc 5d ee 41 c0 41 4c 026c 89 c4 65 01 1b 26 8b 21 12 9e 95 d9 79 f6 3a 53 be 5c d8db 0f 5c 29 07 49 a2 bc 04 30 79 f5 25 a1 29 9f d1 7f 69 8b7a 2a eb ad 76 5a bb 2b 99 29 28 84 08 67 51 d8 0f b5 52 eceb 13 99 67 a2 3d ca 45 03 e1 2b b8 c0 52 bd d7 b1 82 4d 9024 ba c7 1c 40 51 e2 7a c1 52 27 04 44 96 5c 00 2a 48 be e705 07 0c 6d 82 50 35 95 2f ef e4 20 73 32 22 43 2d 41 4c e6c3 e2 4e c1 16 4a 02 a6 e7 23 10 b8 0f 2c 14 aa fa 4f b6 ad68 af 87 73 15 65 f1 24 19 74 b5 f2 9d 67 f6 12 17 b0 b4 ec15 7a 46 71 77 6d d4 0d c2 42 19 08 24 a1 d8 16 06 24 1c 895e d9 42 e7 59 5a eb 73 7a c0 78 48 58 1d 14 0e 84 7c cd 3158 8c 95 50 75 ec 90 c7 f2 13 81 21 a5 43 44 08 d8 6e b9 4caf f7 bb 1b 4e 03 de 60 e6 5c 4d a9 74 40 b8 41 e3 2f e0 0ae5 84 89 ac 98 a9 e0 5d 51 15 b8 79 3a fa 35 a5 8e 96 47 f577 1e 95 68 73 c1 aa c3 cd 87 c2 83 61 fd 1f b4 4b db 42 00cd 3a 06 39 da a8 cb 26 41 bc 18 4e a4 44 ef f2 44 b3 e4 b03c 76 e2 ae 8f 1d cf c5 59 6b 5a c1 55 3e 62 4a ce 04 4d 5079 39 a9 8c 4e e2 9a 46 ef 52 c7 34 a6 c5 ea 28 01 32 3c 7c10 09 c6 2c f0 97 c8 a8 37 1a 7b c9 db b1 bd c4 e0 eb 28 2157 dd 2a a8 58 e4 df 22 1c e1 b9 17 f7 ec 37 76 21 e3 51 939d 48 ad 0a ed d5 ac b4 6b 8e 9a 67 ba 47 0a f5 d5 ce 7e e033 1a 5f b5 2d 49 35 29 a7 4b 63 27 e3 18 98 a3 9f 06 5e ae42 3f 8f 3d bf f4 83 93 c5 a7 5d e3 18 01 cd 93 2a 2c 1b 4f0f ea d5 94 03 a2 c0 4d 40 76 b8 ef f7 97 5f b8 fa 64 0c 157c c8 67 9f 6b ce e8 62 b3 04 45 ce d8 13 e4 5d a1 22 a7 9200 f2 9a 9c d8 9e ea 17 b1 5c e7 be 73 5c 53 16 ce d1 1b 96a1 17 c2 79 4d 56 8d 08 f1 7f c5 60 74 6f 4b 88 54 45 01 ea4a 84 2a 0a a6 2c 87 b1 48 87 6c f3 25 23 b4 04 f5 39 ed dfa6 cf 1f 7c c2 22 e9 92 b6 24 1b 9f c8 92 1a 8f 89 59 41 84a2 b1 79 ba a7 0d 15 59 90 1d 8e 03 0c 85 a9 c1 71 a0 9a e5f6 d9 39 c6 81 eb d3 93 a9 ae 25 1c 19 59 14 75 c9 63 83 70f0 eb e9 c5 e9 c9 5f 6f 72 31 21 3e db a1 23 7b 6a fb f7 7b3c 30 5b a1 52 24 55 e2 22 73 38 82 a8 59 a7 48 41 03 c2 6205 9e e8 82 2d d0 dc 24 fe e9 c8 8d d5 f8 c0 71 db d1 cf a3a9 47 42 52 b3 25 a8 0d f6 2e f1 99 c1 7a 2b dc bf d3 55 e6e2 d3 9b af fb f0 0b b6 fa 24 09 46 48 0e d3 a6 15 d3 80 32b4 68 2e 61 c5 34 08 d6 5a a1 58 5f 06 36 d6 52 c4 ef 5d ee0e c8 a4 15 80 78 aa 8d b0 cc ee c4 d7 3e ff 45 be e2 eb ef33 b2 49 67 52 2c db e2 d2 25 aa d1 4d a0 01 c6 e2 22 e0 43bd a6 cc 50 fa 0c 95 83 0d 33 c5 ed f0 08 72 33 74 77 8d a35d 34 e7 c8 37 9f 08 46 29 65 cc 74 f2 9e 53 79 32 51 5e 61bc 8e b4 da dd ea f3 73 7f 70 e5 95 04 e5 13 43 71 74 a5 240f e0 a0 c1 d7 36 be 11 65 ea d3 93 33 98 a1 4f 29 e3 8a 8c05 05 a8 b9 87 d0 74 a1 0c 4c d5 1c 02 7a dc 23 42 bb ca 0eb2 5f 3f 5c 7c cc 1d b4 3d 51 a3 06 b4 13 ee 23 be ef af b44c b9 aa 38 e6 5b 18 ff bc 43 73 fb 7c 16 69 0a d5 13 56 281a 32 39 89 98 7f 87 33 05 4c 87 9d 35 ce 70 b1 75 3a e6 ba07 ff 1a f3 a8 e4 f6 a2 2d a9 b6 de a8 de 77 5a 86 1a 0b e077 8c bb 33 84 7f 9f e5 79 32 78 ca 6f 66 05 d3 87 c3 97 a34e 14 3e a5 62 a9 a9 cf e0 d4 7e 56 33 af 08 45 fa 93 15 5b2d d9 80 00 80 cb 7a 95 d5 1e 73 07 61 f1 03 2e ac aa 62 89c0 fb 65 64 1d b2 18 05 1e 01 60 8e 23 38 56 c5 14 5d 67 dd29 07 8b 0d 3b 75 06 e5 4b 27 85 76 09 67 3a 8c 60 1e 76 f62d f5 d8 56 ef c4 c1 62 34 6c ce f2 0f 22 75 9a 7f a4 b8 b1b3 39 03 d8 4b e9 79 24 55 55 31 68 c8 e2 33 52 55 e5 1a ca8a 2f 43 3d 7f 93 c7 f1 6b 00 da 7c 44 19 8e e5 0e d9 bd 71ab 33 65 7b 6f a7 9a bc f1 12 b3 02 39 89 86 4d 95 49 c2 61a9 aa 0c c7 43 7d 02 3a b1 b4 b1 ba c1 77 57 cc 23 e7 e1 57fc 73 f8 6a c9 98 fc c5 33 3e f7 a9 a6 8b fb 5f 9e 19 14 345f 9c 14 fb 3c 46 8c 9b fb 04 20 80 80 ea a6 31 2a dc f3 80b0 6d 22 0c 53 0e 29 93 41 08 c2 72 20 42 07 7b dd 5d b5 710f 89 df e4 ee bb fb 35 12 9d 91 34 ba 44 a7 f0 26 33 13 8587 cd 10 2a 72 6b 24 1e eb 12 66 e2 40 06 12 a4 81 c8 df c6a0 86 fb 08 23 bf 1e 25 c6 0f ba 9f 9b a2 54 b9 73 15 c7 df34 28 4f 0a c3 1f 9d f9 93 3d 16 d1 d6 0f 97 4d d5 48 31 fa13 c2 86 d2 68 63 f1 d6 31 6f 36 d1 17 8d b1 b4 97 d9 a8 79d6 12 e7 5a e1 1e 47 82 ea 69 60 6d f4 05 4d 2f 25 8e 34 0aab e8 92 d0 b1 6b 14 3a 64 c3 d3 30 0a 59 d0 6a 16 4b c7 fcac 63 c9 2c cf b6 c9 62 6b 39 88 7b ec 5c 19 6f d8 91 5d cc93 3d 1a 20 f5 82 47 5e 86 3c 32 ad 01 2e e2 99 34 58 05 33d4 1a d3 72 9d 91 20 80 da 72 9d 09 8e 8f cc 5a 35 71 3e a2e6 2a 02 d6 a0 e8 1d e0 8e 33 6c af ec 02 b9 3d be ff c2 9948 e3 d2 7b 91 39 11 14 e7 4c 49 a7 83 43 c7 80 c1 1f 24 38c8 0e 53 03 0c 1a 6f ad 40 5f 49 98 b5 3c 4d 8c 6c 95 c0 fb41 80 ad 52 35 43 61 24 9a a6 f1 d4 ca a1 35 0d 46 74 84 a04a 42 63 13 eb b5 ce 66 4c b0 67 33 bf 48 b6 97 74 d9 b5 597c 0e 94 8a 34 da d8 3d 40 d8 11 05 ff 33 1f 60 af 62 39 0eea 2d 21 0d 51 d7 b9 2e 0d 0f 13 ba cb 0f 87 51 dc 1b 0f 98fc ca 9d fb da 2f 36 59 22 df 30 7f 87 9c 8f 73 ff 84 a2 a6c1 a8 4b dc 2c 2c 46 6b 13 d4 8a c4 7b 52 09 b5 78 a8 c4 1842 bb b7 b6 51 44 0a 00 29 7f 6a 46 c8 85 9b 34 48 78 00 4105 e1 a1 de f2 ef 19 3d f4 bb f8 1c 84 33 17 09 87 a0 45 405c 4e 18 71 45 34 6c 80 48 51 9e 61 82 fe 9b 14 9c 04 ee 2858 83 d2 3e 79 e6 92 95 d7 18 67 2e 3b 61 12 46 b2 92 47 92c3 44 4d f2 c7 23 5d e9 41 cc aa 01 61 6b 95 24 5f c1 10 b5b2 e4 bf c4 f0 93 61 a7 af c8 2e dc 2c 3b e7 1a 67 6a 3e 664e b1 76 b4 b2 91 ba c3 74 0f 32 3c ad 8d 64 09 aa 98 93 364d a2 39 f5 23 b4 1c 8f bc e5 f0 55 f6 71 50 27 31 21 6d 053d 9b 2f 33 74 74 3c 5d 0c 94 e9 2b ff 64 23 ad d4 9d ec b3e8 e3 e5 5f 79 41 b3 6e 6d d4 bd 12 4f 21 13 f8 73 4c 85 beb7 a1 6c ae 63 6f 3f 5a cf 5e a9 6a 64 53 4a 42 18 ac 1e 8312 e5 20 e5 29 b0 1a d2 8d 5f 02 7e 6c ab c8 62 9d 26 5d 03ba 98 22 23 d2 53 84 10 9f e6 88 d1 d6 ac e2 cc 3e ab 37 d8e8 2a cb 06 4a b0 21 5f 07 25 03 89 5c 85 25 78 78 ab 8d cc4e 5c 90 0c e0 53 3b 9e ff a3 17 ba 95 36 08 96 f9 5f 9b 7d7b 9f 47 d7 d2 b8 74 d1 97 2a 25 61 c8 25 b4 12 0e d6 bf c325 b4 80 65 50 20 d4 0c d9 b4 8b 3f f8 64 24 df 34 df ac fe4a 99 34 d5 67 4c 39 06 85 97 65 67 c8 ca 31 41 44 e5 b2 a9aa af 89 b3 b1 71 68 4f fb fd 31 67 72 da 92 fc d5 e8 d9 b767 59 98 a8 4e ad 4c 63 73 9d 8e 16 45 46 8e 98 8f e6 ac 6c44 2d 3e 69 65 3d fe e9 93 94 aa ee 62 71 96 d4 8f 09 85 b0b0 a0 06 81 68 7a 86 33 50 18 d5 27 09 c4 8e ab e3 d9 59 cf5d 12 36 78 48 71 47 51 cb ab 9f 37 d8 43 19 09 55 23 b0 18fc ae b5 6f 0f 91 27 c2 87 fc 8c b3 24 d4 61 a6 dc 7e ea 6c5a 06 da 88 fd ef c1 f6 e2 b8 cf 59 73 7a 43 ae 2b 34 b7 b34f a3 49 f2 49 0c ec ec bf 7f c6 51 eb a5 b8 1b 3d 8a 2e 52ce 29 58 68 50 6d 74 50 58 90 a0 dd a2 75 08 df 6e dc 96 e32e 67 4a 23 8b 54 ad 84 ad 2a 8e 20 52 d0 79 d5 be a4 54 8248 49 3f 68 1f 4a 73 fc 57 31 1f 68 db 3f fe 8d 4f 94 d8 9fed 28 65 8f 27 b2 24 be 83 30 f9 7c f8 11 bd 09 d9 f1 0e 8bae 00 31 8a d5 e4 05 31 12 5c d0 39 73 69 a3 38 d9 d5 57 728d 35 ce ea c2 a4 06 c4 36 3a f3 66 74 9d c1 2b 9d 81 2c 294e 9d d9 18 04 9c fa 41 82 e0 d1 51 da f5 08 6d 23 0c b4 32cf a9 89 a7 c4 20 c2 c4 e5 a7 e1 ef c7 9e 3b 7e 48 0b 54 7a8b de a2 e2 6b 1e 29 c8 4e 26 cc c8 e3 fa 68 a8 05 df da a24a d2 be 10 0f 29 ee 7f 7c c4 67 06 75 53 a1 de 49 b4 9d bf2a fd 9d f6 6a 82 25 94 90 b1 92 ee 2a 4c fd aa 05 2e 40 702e a9 2e cb 36 99 66 46 3a 2f 45 db 26 5f 5e c2 e4 95 59 bf29 fe 46 25 bd 86 11 fa 8d 87 4a ac 89 75 da d6 04 37 90 d06a 2a 39 1e 08 7b 00 21 c3 d3 d1 d7 5a 88 f2 ce 36 4c b2 a8ce 35 63 48 06 2f a1 c7 c0 bc a4 6c 3f 57 cb 56 b2 15 89 53d2 97 58 24 ee d0 dc d5 84 dd 0b aa fb e0 42 5d 7c ce 2e 931d 0f 7e b6 ea 88 17 15 d8 0a d3 6d 8e f2 c0 30 a6 f6 07 f3d1 64 12 c8 93 5f fc 96 7d a9 e6 f1 f5 97 4b 4c 41 a1 3a 91da 3f f0 a5 2c aa a4 e9 d5 cc 45 1e 41 d5 16 b2 36 49 e0 1128 84 32 91 25 23 21 1e 25 5d e8 b8 2a 97 16 ac 3b f6 8d d79f 3e e1 26 42 4a 4c 38 1a 11 d2 61 0f a9 90 09 bb 75 90 8197 13 3a 22 4d 0a d4 fc 32 db 1c 84 88 d2 15 49 71 a0 97 d252 a1 78 d9 cf c8 92 7d 93 98 a4 c2 25 f2 35 1f fe 98 c6 1eb0 df 22 3c d2 38 6b 3f a0 55 04 5c 53 aa 86 d8 00 7b bd 6a88 a3 e8 72 e2 2e 4d 92 77 33 98 fb 9b df fa 82 66 61 13 bceb 2a 85 a1 da 21 77 2d 65 27 4f ab fa f0 b5 34 35 66 bd 0ed7 5a 8b 61 10 6f 9c 4b 9c 6a 19 68 9a 7c a3 90 d5 dd c9 6700 5c ce a6 ae 38 81 98 12 e2 e5 52 6f 5b ca 23 87 50 26 61bc 71 88 e8 04 d0 a6 02 d2 c8 a2 d3 96 d7 94 64 69 79 ba 0d0e 7c f1 99 5f b2 af 3d c4 60 55 d1 11 79 83 35 bf 51 bd 4c5a f0 5e 19 6a 23 d2 18 06 51 9b 61 4a 0c 15 19 cf 4f fb 7c53 4d 82 fe da 78 d2 3c db f6 ab 93 4e 8d 79 83 73 fb 53 7c91 09 b2 d9 93 3f d0 b2 da f6 12 36 a8 74 ad d0 f6 a8 c3 b7d5 8f 3a 52 53 f7 43 4a 6d b4 46 a9 29 47 4e 11 30 d0 d7 a080 28 1d a2 b3 55 cb 02 b5 cf 69 c5 6f 0c 31 f9 22 7c 25 ab09 aa 14 d1 41 d8 37 7b 1e f9 75 c2 96 d9 f1 85 2d 2f 3a 1650 62 f6 d3 8a 64 1d 9a 23 c4 a5 6b f4 26 eb 92 60 71 0d a123 79 b6 34 53 90 0e 46 95 56 32 7f c6 80 4f 3b 3d 80 8e 2dc4 61 8f 68 cc 41 3b 69 b0 b2 25 91 86 9c 3f f9 ed 9f 7f faab c5 07 12 14 d3 8c e8 94 84 f8 08 65 e1 c6 52 4a 9f 7a 80ef 04 13 14 3b 95 28 a4 a7 91 7c fb b5 fd da 94 be d7 a7 f335 e6 ff a1 3e b5 a8 cf 96 e3 64 bc c6 fc 50 5d 51 90 4f 46f5 b8 62 89 64 65 24 e8 f8 96 df 80 50 81 07 35 d5 f1 51 ef2d 8b fb bb 6b da b8 57 7b cc 43 82 07 10 dd 97 b6 68 9e 44dd a1 ba a8 7e fc d9 39 5b 09 d6 7c 6e 23 49 c2 8b 2d b4 97d2 26 e5 48 13 ad 11 c4 14 a4 8b ac a4 bc de 50 62 de 72 ae4b 3a ca 83 04 a5 29 58 90 d9 b4 1e c5 7e 1f b0 ef a6 e2 aac7 f4 41 4a 88 8c dd fd f8 4b 65 e4 4e 2d 19 ab 17 18 87 51e2 11 78 34 82 11 60 bd c9 3e 9a 76 a7 7f 69 3f fe 85 96 0d33 8c 26 7e 85 f5 03 f7 5c c8 d4 b8 70 95 1d b8 c6 ec ba f457 c4 ac 17 45 7b b1 cb a4 92 f7 91 8f 6b ab fd 7c fb b8 06c3 e5 9e 9a a5 ac 04 a6 68 ec 73 af 7d 4d 1b 2e c2 6a 83 5393 43 37 c1 74 e4 df 89 ee 22 3e 44 7d bc fe 60 eb fa 46 9c93 88 32 22 a0 60 35 29 42 12 c0 49 83 d9 8e de 59 90 04 6544 85 05 a2 ca 94 1e 10 d8 a5 ae c4 68 b5 d7 e9 1d 35 42 4c85 6b 90 05 09 0a be 17 ae 93 2b 72 f4 b4 56 9a cd 41 fc 56dc db 95 a6 d1 91 73 93 d7 dc 41 53 86 30 3f db f9 9a fc d1ea 07 83 91 54 a5 17 19 74 94 a9 e2 9f d9 fe 93 bd c5 e7 001b 2f 53 df d8 31 bc d6 fa d0 74 29 6c 47 ab 3c fe 42 96 2d1a 37 df 6c f8 a1 e1 2e 9f c7 83 c9 04 05 18 b1 7c de dd ee05 c4 57 4c ad 7c 6b 94 a2 a3 42 1f ad a6 69 5c 6e 99 c3 5cbe 31 91 d2 98 a9 72 84 fd 9b 94 8b 26 55 6b 3e 6f b0 c7 514c 1f e7 49 5d 0f 04 fc 56 a2 6c 82 d6 78 99 18 66 7a 10 0196 31 fc d4 ca 4d a7 6a cc 98 ae d4 fe b4 30 08 67 d9 27 ab7d a0 44 9a 84 59 fb c1 72 90 54 dd dc 06 3f 88 b9 0c ff ebfd 77 da fb 91 8f ff 90 23 58 b5 86 fb f9 04 41 a5 bd b1 889b 4d c5 58 7a 64 3d f9 ed 57 ff cf c8 c9 7a 2b fe 56 85 e1c7 bd c1 a8 6f 20 22 10 1d 97 5a df dd af 61 5e cb 02 e9 b3cc f8 22 71 3e fb b0 82 25 a9 78 62 b4 49 25 0f d0 fc 3c af10 0e 8d aa b7 6e e3 d7 81 bd f2 a8 33 f6 e0 60 10 d6 37 9e99 f3 ab be 78 bc 7d f6 d7 80 a0 1b 1e a4 7f 9a 78 bb ec 3240 19 d8 1a 5d 6d 6f 1d cd 6d d0 9e e0 c8 5b 78 8f fd 19 86dc 89 7a f8 98 10 65 a0 58 65 99 5f 10 c4 74 4f b4 2b ee 4f02 65 24 94 97 c8 a6 63 0a 53 5e 8f 13 ce 81 8a a9 53 87 98e8 ce 40 6c 5b bd 8e 4e 2c 49 a8 69 06 e5 83 95 a4 4b 7d 6ea7 83 a5 26 8c ab 3a 9e 53 41 40 81 4c 16 74 09 d3 f8 a0 cff0 42 8b d6 13 a3 f1 61 14 30 82 ce af fc e7 07 35 f5 d6 61db 5b 48 7f fb 3c c9 20 5a 10 81 c8 ca 87 f5 b3 7b 0f 82 6a5a 99 35 c2 ab 69 cd 9c a6 18 b6 da 4c 85 8d 98 bb 98 eb 4d8d b9 84 76 2b f9 46 76 f4 d1 1b 5f 70 10 94 64 de 01 82 c810 50 e4 3d 94 21 b4 01 0f be 86 a3 c3 67 22 d9 d6 30 cb 517c 46 c8 d8 ae 20 ec 21 65 7d d0 8c 04 dc ee 90 20 45 cc 9622 3f 29 c4 f1 98 d4 0a 95 40 4b f2 1b c3 3a 45 54 ff d3 5bfe d1 23 9a f9 47 e8 ac e2 03 23 b9 77 84 f7 11 e0 85 19 bdcc 20 58 0a 5b 81 58 07 c2 5a 6e ce 69 df c8 b0 c9 af 9c 38e0 b1 8b 64 e7 b4 4d f4 f4 ec 6d af 9d 28 21 73 d0 a4 3c 6c92 9c ae 38 34 ed 82 ed 84 98 ff c7 b7 53 73 3b fc 44 89 c144 1e 07 9c 37 d9 aa c6 e2 c0 6c 41 83 2a e8 97 94 9d cc 437e 6d 31 17 4a aa 79 c6 5c 70 5d e1 46 fb 3e 04 4a 9e 3b 4f62 c7 5f 7e 48 23 99 74 c4 13 2d 4c e3 61 30 ef 11 27 4c 3097 4d 9c e0 59 70 85 32 f3 dc c1 16 0e 39 9b f0 b1 4a 2d 994c c9 ea 48 cc 50 93 49 48 b5 47 0f ad 0b ec ad 4b 2a 83 0de8 da 28 70 00 c9 80 5c 36 8c 6b dc 66 6c bc db 3d f4 3a 11bc d3 42 41 f3 e1 17 ca eb 29 1a bc 5a 2f dc 7f 83 e1 48 901b 25 29 43 00 e2 eb fd e3 d5 15 36 ca ef e5 11 eb 97 91 7728 76 5c 5a 4d b5 83 d4 cd a4 e5 c1 79 32 bc 13 c0 a7 1c dc59 81 07 32 e7 d4 92 d4 3d d8 b8 18 ab 1e 10 99 f4 0d 51 9566 26 7d 1f 47 62 cd 79 c1 b6 60 2c 68 7d 11 01 59 66 82 dd50 6a e1 00 6f 32 7d e9 dc 6a 9f 0f 9c fe 58 c1 4e fe 0c eeb9 5c 91 47 a8 52 c8 22 7d ea a3 f2 bc cd 21 d7 f1 da 66 da48 88 25 23 2e f6 29 97 62 a2 1b c8 6a 5c 28 9b 98 2f c6 3eeb 90 dc c1 e9 47 61 68 dc f2 6f 4e 7e 89 d0 70 51 43 f2 e451 e7 ba 92 03 50 51 0d 93 c8 76 79 73 d7 97 59 08 16 4b b678 b1 9a f3 47 0f 3a e8 52 16 fa e1 64 1e 40 ea 42 ff 5a e8f7 86 13 39 71 bf 7c 67 19 b6 3d 35 87 de 2c d5 84 cc ec 0cf8 45 07 03 85 7c af 25 35 bb 56 d1 4b 65 4a 45 12 85 a8 9d32 90 07 a4 02 3f 05 27 3b e7 25 ee b9 e3 af 35 df 9b ac 3537 33 ef 21 ff 03 1b 7f 38 a3 92 11 9f 90 82 fc 9b bf 60 cbb7 94 8e 12 81 2c 4a 82 84 ed 30 ac 5b ac e3 db 1e fb e7 2f10 3c 80 68 56 34 65 35 dc 4d dd 23 45 77 77 7b da 57 12 3355 35 a5 5e 86 5d 28 77 ca fe df d1 7c 51 88 45 5d a4 eb 2c4f d5 a9 47 fe f3 08 5e 81 e4 36 37 8a ff 27 48 ee 23 a5 2545 ee d0 20 e6 49 d9 85 09 98 ed cc 16 16 aa e0 90 77 27 8e3a ad 15 36 1a ad 65 9e 8a bd c8 9e 35 8c 5a bc 46 7b f3 7cca 45 5c 7b bd ea e3 ff ea ab 94 44 78 09 65 10 50 17 01 6450 18 1f 72 91 56 b8 5c 21 14 98 c9 ec 67 a1 a0 38 0e 1a 04c5 72 b0 29 0a 9a 1d b2 17 e0 62 82 e0 13 bb 51 ac 55 b1 0439 75 6d b6 2f 9f da f1 d9 ff a5 09 3f 47 15 9c 3c ff 7a 1d61 06 04 5a 8d 84 4e dd 57 dd bf d5 25 4c e5 69 93 bd 49 79c7 e3 5d f6 47 01 a0 2a 7b 5a d5 7c ea f7 b9 47 4e d7 a7 a1c7 c6 f4 ec a2 dd 83 65 43 10 4c b4 70 10 c6 41 5f 11 07 e2c3 a8 2e 51 d6 d4 a1 57 3b 84 57 72 e6 a9 d7 cf d9 75 d8 a35b 79 af 61 8d 8e 44 72 f8 6f 0d ea 0e 9d ab 43 12 73 ac 1b57 87 cb d5 d9 9d f6 97 44 54 c2 2a ee 58 49 2e 60 33 db 97c6 f5 19 e1 6f 1e a1 d4 b0 cc 85 53 01 84 aa 92 b0 73 b8 d275 47 b7 c7 fa b0 81 c7 0a 23 24 17 58 01 6d 01 3a a2 d1 9ad4 38 83 09 53 3a e3 98 9d 45 bb f5 ef 28 18 39 a2 c6 52 74c6 bb 28 2d 43 0b a2 aa 54 7f 1b 36 0c 22 83 2f e0 39 7c 17ec ce 7e 1f 29 85 a7 b1 33 fb 8e 49 92 a3 61 03 5c 94 16 c499 cb be 3b 1a 2d 32 8b ac 01 7c 7d 61 9f 87 03 2e b2 6d d0e9 05 c3 c6 2e f0 d6 c1 b2 78 06 b8 bd 1d 2d 2e 86 1d f8 d445 f6 26 13 78 49 57 3e 01 f4 23 6d 1b 36 c4 e6 84 f5 f6 4dd9 37 cb cc 44 e9 cd 07 4c 83 85 df 32 8d 7f c0 f0 ac 69 3b6c 9c 01 5f 9f 3f 83 2d d1 e9 24 84 ad 8e 47 3d f6 32 f0 1d94 c3 0b 5e c4 35 c6 fc c8 89 42 cb f0 92 70 39 5a ca b7 33e2 dc 4d d1 00 9a 35 47 99 2e d5 5b e8 f1 b3 41 74 07 b6 c89e 31 df 85 65 5c e5 43 b3 1a 45 3b c0 80 4d c7 4b f0 e5 647c a6 2a 45 05 ba a0 84 4b e3 74 f0 76 4c 8c b6 d4 4b cf 1587 07 4e 81 68 73 c0 a6 00 0c ed b8 d7 67 8e a6 05 76 0c e5c6 62 c2 e4 39 2c e8 20 6f 65 eb b4 31 0b 26 2b 5c cd af 2a36 14 21 ec 6c 87 fb 40 d9 4a 39 ab 78 51 aa ab 1b c1 6a 50a2 30 d1 5c a6 61 9e 5c 65 a3 01 ac 16 f0 91 b8 3c 85 8f c0a6 93 61 17 0c 47 e7 8d 51 f2 d8 0a c8 19 ae 2b 23 4c 10 04fe 1b 5b 56 54 9d 19 22 84 54 46 91 66 ef 2d 1d 09 95 ee 20c7 6d 7a a2 95 89 0e 75 c4 e8 a8 e8 5a 6a 8c ce 60 cf 25 8695 97 44 1d 02 42 50 5a ac 1c 21 ef 4c 83 82 29 83 6c 8b 3857 99 ec d4 9c b3 03 5f 7c 06 31 e1 24 0a 21 40 3a 8e d4 b31e 86 61 7f 03 01 b9 13 7b 29 6a 8f 7b 42 b0 df e2 7e 7f bca2 54 06 aa 50 f7 d6 25 ee 47 19 48 c1 3e b3 a8 a1 d6 87 ec0b 4b 06 72 54 00 f0 a5 b3 4c b4 82 09 24 c2 b2 d1 4a 41 f9e8 68 0f f8 c8 21 19 26 b6 0e 11 76 e4 70 12 2c b4 1b 0d dab8 ca 5b f6 e0 96 26 c6 dd 4d d0 27 e5 b9 e3 bd 99 2f 42 5a8e c3 15 d6 f0 3e b9 74 da d1 64 d2 0f 6b aa 80 2c f7 9b 4613 83 e1 99 32 8b 07 bb 52 8c ca e6 fd 5f d5 92 c0 5b 84 63c5 98 b3 07 cf ba aa a8 04 01 d2 c4 9d c4 59 d4 c5 9a 19 9ff0 f4 06 12 32 41 94 d4 d6 83 93 b0 1a d1 84 70 12 cd 60 74e3 0f 08 52 88 f8 01 8c 71 03 c1 51 0e 42 72 25 cb 50 5d 0c5c 20 de 6c df df 9e 0d eb d6 49 8c 7a 21 12 6e 9d 2c 17 69b6 c7 25 2d c3 1d 17 bb bc 58 d8 63 a5 e6 15 2c ac 7a 67 d64d 71 d5 0e 06 ed 28 6a f1 4b 08 14 57 f3 d4 0d 8c a5 e8 012c be ee ec bc eb a8 d2 af 1a e0 03 70 96 cc d2 5d e9 46 f2c6 51 86 e6 af c8 d2 bc e9 57 0d 9f 40 85 7a ad 73 e4 60 c845 73 e8 d9 1c 02 52 f1 cd e2 a0 d4 b3 2a 44 7d 67 44 12 351a 0e 97 12 64 4f 8a 90 a7 b3 df 34 01 fd 94 a2 0b 36 2e 303d 1b 13 89 0d 44 ca 31 29 85 26 18 8c b8 5f a8 c5 7f e4 6341 2a d2 84 68 df d0 7f 92 51 65 91 9d 28 17 62 eb 1e 82 5a02 4d 69 ee d2 be 32 92 53 8e 82 91 89 6f 99 21 1f 1d a9 d7f0 ea 34 e7 a2 8f 0e fa 1c e2 e1 78 65 dc d9 2c 0f 06 fe 6763 67 34 1f 06 c3 56 3c e5 9e 62 2e 8f b7 75 c2 71 18 4f 989a d0 ef 37 e6 98 ec eb f5 c5 af ec 31 41 cc 50 27 f8 0d 1ba4 01 87 38 d4 2d a3 b5 38 18 f4 f2 6d 8a aa 91 e8 68 08 b544 ae 30 b6 b2 19 b2 d1 dc a5 7d d5 78 a4 a2 14 40 7e 74 6d94 e2 2d 52 2e fc c5 d9 7b 6c ec 79 29 99 94 67 ec 2b f7 e0df 6b df 31 50 a1 02 ce b1 ec db d2 79 f6 6f 35 6d ac 60 49ef b9 d0 61 c2 45 a9 c3 ec dc 72 e9 89 8b 2d c3 21 d5 7c 2291 30 77 b6 1e 21 1c 47 28 4f 22 74 5a d7 c8 94 f8 50 05 e15c 77 ba 9f 23 1a 87 47 cf b7 b2 9c bf 0d b2 04 8a f8 92 c33d c1 7c 03 17 5a e9 1d 72 7d 6c 7b e8 65 5b 80 9e 42 fa 3d02 f4 be 7b 70 cb f7 fe 3f 8f 54 29 4d"
    )
  );
  console.log(`achievements:`, JSON.stringify(achievements, null, 2));
} catch {}

let packet_id_protocol = native.with_byte_length(
  mcp.varint,
  combined([
    { name: "packet_id", protocol: mcp.varint },
    { name: "payload", protocol: native.uint8array },
  ])
);
