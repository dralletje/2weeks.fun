import {
  blocks,
  find_packet_name,
} from "@2weeks/minecraft-data/src/minecraft-data.ts";
import { Record } from "@bloomberg/record-tuple-polyfill";
import chalk from "chalk";
import { floor, isEqual, range, zip } from "lodash-es";
import { Signal } from "signal-polyfill";
import {
  BasicPlayer,
  type Hotbar,
  type Slot,
  slot_data_to_slot,
  slot_to_packetable,
} from "./BasicPlayer.ts";
import brigadier from "./plugins/brigadier.ts";
import smite_plugin from "./plugins/give.smite.ts";
import give_plugin from "./plugins/give.ts";
import map_plugin from "./plugins/map/map.ts";
import npc_plugin from "./plugins/npc.ts";
import show_other_players_plugin from "./plugins/show-other-players.ts";
import summon_plugin from "./plugins/summon.ts";
import tp_plugin from "./plugins/tp.ts";
import window_plugin from "./plugins/window.ts";
import { makeBossbarsDriver } from "./Drivers/bossbars_driver.ts";
import { commands_driver } from "./Drivers/commands_driver.ts";
import { makeEntitiesDriver } from "./Drivers/entities_driver.ts";
import { keepalive_driver } from "./Drivers/keepalive_driver.ts";
import { makePlayerlistDriver } from "./Drivers/playerlist_driver.ts";
import {
  type ResourcepackRequest,
  resourcepacks_driver,
} from "./Drivers/resourcepacks_driver.ts";
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
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "./PluginInfrastructure/Plugin_v1.ts";
import { World } from "./PluginInfrastructure/World.ts";
import { combined, concat, native, type Protocol } from "./protocol.ts";
import { type TextComponent } from "./protocol/text-component.ts";
import { type AnySignal, effectWithSignal } from "./signals.ts";
import { entity_id_counter, NumberCounter } from "./Unique.ts";
import { modulo_cycle } from "./utils/modulo_cycle.ts";
import { UUID } from "./utils/UUID.ts";
import bossbar_plugin from "./plugins/bossbar.ts";
import { serverlinks_driver } from "./Drivers/serverlinks_driver.ts";
import list_self_plugin from "./plugins/list_self.ts";
import noth_compass_plugin from "./plugins/north_compass.ts";
import { ChunkWorld } from "./PluginInfrastructure/ChunkWorld.ts";
import { uint8array_as_hex } from "./utils/hex-x-uint8array.ts";
import { chat } from "./utils/chat.ts";

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

let teleport_ids = new NumberCounter();

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

let world = new World();

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
  let writer = writable.getWriter();
  let minecraft_socket = new MinecraftPlaySocket({ writer: writer });

  let player_from_persistence = emplace(players_persistence, uuid.toBigInt(), {
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

  let player_broadcast_stream = new LockableEventEmitter<{
    message: TextComponent | string;
  }>();

  console.log(`${chalk.blue("[PLAY]")} ${chalk.blue("Entering PLAY state")}`);
  let server_closed_controller = new AbortController();
  try {
    let signal = server_closed_controller.signal;

    let player_entity_id = entity_id_counter.get_id();

    let view_distance$ = new Signal.State(3);

    minecraft_socket.send(
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

    let teleport_event = new LockableEventEmitter<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
    }>();
    let teleport_in_progress$ = new Signal.State(null as { id: number } | null);
    teleport_event.on(
      (move) => {
        console.log("START TELEPORT");
        let teleport_id = teleport_ids.get_id();
        teleport_in_progress$.set({ id: teleport_id });
        position$.set(move);
        minecraft_socket.send(
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
      { signal: signal }
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
            if (teleport_in_progress$.get()?.id === teleport_id) {
              teleport_in_progress$.set(null);
            }
          },
          { signal: signal }
        );

        minecraft_socket.on_packet["minecraft:move_player_pos"].on(
          (packet) => {
            let { x, y, z, ground } =
              PlayPackets.serverbound.move_player_pos.read(packet);
            let position = position$.get();

            if (teleport_in_progress$.get() != null) {
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

            if (teleport_in_progress$.get() != null) {
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
            if (teleport_in_progress$.get() != null) {
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
      { signal: signal }
    );
    let initial_position = position$.get();
    minecraft_socket.send(
      PlayPackets.clientbound.player_position.write({
        x: initial_position.x,
        y: initial_position.y,
        z: initial_position.z,
        yaw: initial_position.yaw,
        pitch: initial_position.pitch,
        teleport_id: 0,
      })
    );

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
      new Set(["creative_mode", "allow_flying"]) as Set<
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

    // let statusbar_text$ = new Signal.Computed(() => {
    //   let position = Array.from(entities$.get().values()).at(-1);

    //   if (position) {
    //     return `Yaw: ${floor(position.yaw, 0).toFixed(0).padStart(3, " ")}`;
    //   }
    // });
    // effect(async () => {
    //   let statusbar_text = statusbar_text$.get();
    //   if (statusbar_text) {
    //     await minecraft_socket.send(
    //       PlayPackets.clientbound.set_action_bar_text.write({
    //         text: statusbar_text,
    //       })
    //     );
    //   }
    // });

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

    let player = new BasicPlayer({
      name: username,
      texture: texture,
      uuid: uuid,
      teleport_event: teleport_event,
      player_broadcast_stream: player_broadcast_stream,
      position$: position$,
      hotbar$: hotbar$,
      selected_hotbar_slot$: selected_hotbar_slot$,
      field_of_view_modifier$: field_of_view_modifier$,
      view_distance$: view_distance$,
    });

    world.players.add(uuid.toBigInt(), player);
    my_chunk_world.join({
      player: player,
      signal: signal,
      socket: minecraft_socket,
    });

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
    //   return { time: BigInt(actual_time$.get()), locked: true };
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

    let resourcepacks$ = new Signal.State(
      new Map<bigint, ResourcepackRequest>()
    );

    let entities$ = combine_sinks(
      plugins$,
      (plugin) => plugin.sinks?.entities$
    );
    let commands$ = combine_sinks(plugins$, (plugin) =>
      plugin.commands == null ? null : new Signal.State(plugin.commands)
    );
    let playerlist$ = combine_sinks(
      plugins$,
      (plugin) => plugin.sinks?.playerlist$
    );
    let bossbars$ = combine_sinks(
      plugins$,
      (plugin) => plugin.sinks?.bossbars$
    );
    let serverlinks$ = combine_sinks(
      plugins$,
      (plugin) => plugin.sinks?.serverlinks$
    );

    let effect_for_drivers = (fn) => effectWithSignal(signal, fn);

    ///

    let world_mapped = my_chunk_world.map_drivers(player, {
      entities$: entities$,
      playerlist$: playerlist$,
    });

    ///

    serverlinks_driver({
      minecraft_socket: minecraft_socket,
    })({ signal, input$: serverlinks$, effect: effect_for_drivers });
    makeBossbarsDriver({
      minecraft_socket: minecraft_socket,
    })({ input$: bossbars$, effect: effect_for_drivers, signal: signal });
    resourcepacks_driver({
      resourcepacks$: resourcepacks$,
      minecraft_socket: minecraft_socket,
      signal: signal,
    });
    makePlayerlistDriver({
      minecraft_socket: minecraft_socket,
    })({
      input$: world_mapped.playerlist$,
      effect: effect_for_drivers,
      signal: signal,
    });
    makeEntitiesDriver({
      minecraft_socket: minecraft_socket,
      player: player,
    })({
      input$: world_mapped.entities$,
      effect: effect_for_drivers,
      signal: signal,
    });
    commands_driver({
      minecraft_socket: minecraft_socket,
      player: player,
      getContext: () => ({
        player: player,
        players: new Map(
          playerlist$
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

    let build = new ProcessV1(
      ({ signal }) => {
        minecraft_socket.on_packet["minecraft:player_action"].on(
          async (packet) => {
            try {
              let { action, location, face, sequence } =
                PlayPackets.serverbound.player_action.read(packet);

              if (action === "start_digging") {
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

            let face_vector = Faces[face];

            let inventory = hotbar$.get();
            let slot = inventory[selected_hotbar_slot$.get()];

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
                x: location.x + face_vector.x,
                y: location.y + face_vector.y,
                z: location.z + face_vector.z,
              };

              let player_position = position$.get();

              if (
                modulo_cycle(floor(player_position.x), 16) ===
                  block_position.x &&
                modulo_cycle(floor(player_position.z), 16) ===
                  block_position.z &&
                floor(player_position.y) === block_position.y
              ) {
                teleport_event.emit({
                  ...player_position,
                  y: player_position.y + 1,
                });
              }

              let state = block.states.find((x) => x.default)?.id ?? 0;
              my_chunk_world.set_block({
                position: block_position,
                block: state,
                transaction_id: sequence,
              });
            }

            broadcast_stream.emit({
              message: `Block placed!`,
            });
            broadcast_stream.emit({
              message: `  Cursor ${cursor_x.toFixed(2)}, ${cursor_y.toFixed(2)}, ${cursor_z.toFixed(2)}`,
            });
            broadcast_stream.emit({
              message: `  Location ${location.x}, ${location.y}, ${location.z}`,
            });
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
            position: position$.get(),
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
      world.players.remove(uuid.toBigInt());
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
