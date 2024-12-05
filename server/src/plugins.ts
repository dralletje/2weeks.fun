import { Signal } from "signal-polyfill";
import { find_space_above } from "./minecraft-utils/find-space-above.ts";
import {
  type Plugin_v1,
  type Plugin_v1_Args,
} from "./PluginInfrastructure/Plugin_v1.ts";
import brigadier from "./plugins/brigadier.ts";
import build_preview_plugin from "./plugins/build-preview.ts";
import default_build_plugin from "./plugins/default-build.ts";
import display_plugin from "./plugins/display.ts";
import gamemode_plugin from "./plugins/environment.ts";
import give_plugin from "./plugins/give.ts";
import list_self_plugin from "./plugins/list_self.ts";
import map_plugin from "./plugins/map/map.ts";
import navigate_plugin from "./plugins/navigate.ts";
import npc_plugin from "./plugins/npc.ts";
import show_other_players_plugin from "./plugins/show-other-players.ts";
import summon_plugin from "./plugins/summon.ts";
import summon_with_eggs_plugin from "./plugins/summon_with_eggs.ts";
import tp_plugin from "./plugins/tp.ts";
import variants_plugin from "./plugins/variants.ts";
import window_plugin from "./plugins/window.ts";
import worldedit_plugin from "./plugins/worldedit.ts";
import { ConstantSignal } from "./utils/signals.ts";
import { chat } from "./utils/chat.ts";
import { UUID } from "./utils/UUID.ts";
import { v4 } from "uuid";
import { c, command } from "./PluginInfrastructure/Commands_v1.ts";
import heads_plugin from "./plugins/heads/heads.ts";
import makeEnvironmentPlugin from "./plugins/environment.ts";
import on_screen_compass_plugin from "./plugins/on-screen-compass.ts";
import pathfinding_test_plugin from "./plugins/pathfinding-test.ts";
import render_system_plugin from "./plugins/render-system.ts";
import spawn_plugin from "./plugins/spawn.ts";
import run_systems_plugins from "./plugins/run-system.ts";
import { apply_velocity_system, gravity_system } from "./systems/physics.ts";
import { grazing_system } from "./systems/animals.ts";

let ascend_if_falling_plugin = (arg: Plugin_v1_Args): Plugin_v1 => {
  arg.position.on_move.on(
    ({ from, to }) => {
      if (to.y < -10) {
        let new_to = find_space_above({ world: arg.world, position: to });
        return { from: from, to: { ...to, ...new_to } };
      }
    },
    { signal: arg.signal }
  );

  return {};
};

let serverlinks_plugin = () => {
  return {
    sinks: {
      serverlinks$: ConstantSignal([
        { label: { false: "Developer" }, url: "https://dral.dev" },
      ]),
    },
  };
};

let resource_pack_3_plugin = ({}): Plugin_v1 => {
  return {
    sinks: {
      resourcepacks$: ConstantSignal(
        new Map([
          [
            UUID.from_string(v4()).toBigInt(),
            {
              url: "http://localhost:8080/resource-pack5.zip",
              // url: "https://cdn.modrinth.com/data/p6lVqTvA/versions/MRiSl0Y9/Hypixel%2B%200.20.7%20for%201.21.1.zip",
              // hash: "79c5aeb36f072936cafd1e29f0ae3f707ae1a1c9",
              hash: "",
              forced: true,
              prompt: "Do you want to download this resource pack?",
            },
          ],
        ])
      ),
    },
  };
};

let xxxx = ({}): Plugin_v1 => {
  return {
    commands: [
      command({
        command: c.command`/give dral:diamond_dust`,
        handle: ([], { player }) => {
          player.inventory.set_hotbar_slot(
            player.inventory.selected_hotbar_slot,
            {
              count: 1,
              item: "minecraft:shulker_shell",
              properties: {
                custom_model_data: 1,
              },
            }
          );
          player.send("Given diamond dust");
        },
      }),
      command({
        command: c.command`/give dral:fence`,
        handle: ([], { player }) => {
          player.inventory.set_hotbar_slot(
            player.inventory.selected_hotbar_slot,
            {
              count: 1,
              item: "minecraft:shulker_shell",
              properties: {
                custom_model_data: 3,
              },
            }
          );
          player.send("Given diamond dust");
        },
      }),
      command({
        command: c.command`/give dral:fence2`,
        handle: ([], { player }) => {
          player.inventory.set_hotbar_slot(
            player.inventory.selected_hotbar_slot,
            {
              count: 1,
              item: "minecraft:shulker_shell",
              properties: {
                custom_model_data: 4,
              },
            }
          );
          player.send("Given diamond dust");
        },
      }),
    ],
  };
};

let announce_joined_game_plugin = ({
  player,
  send_broadcast,
}: Plugin_v1_Args): Plugin_v1 => {
  send_broadcast({
    message: chat`${chat.dark_purple`*`} ${player.name} joined the game`,
  });
  return {};
};

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

export let plugins: Array<(arg: Plugin_v1_Args) => Plugin_v1> = [
  show_other_players_plugin,
  tp_plugin,
  brigadier,
  summon_plugin,
  give_plugin,
  npc_plugin,
  window_plugin,
  map_plugin,
  list_self_plugin,
  display_plugin,
  worldedit_plugin,
  navigate_plugin,
  summon_with_eggs_plugin,
  build_preview_plugin,
  makeEnvironmentPlugin({
    gamemode: "creative",
    allow_flying: true,
    creative: true,
    invulnerable: false,
    level: 10.5,
  }),

  spawn_plugin,
  run_systems_plugins([gravity_system, apply_velocity_system, grazing_system]),
  render_system_plugin,

  // () => {
  //   return {
  //     sinks: {
  //       scoreboard$: new Signal.State(
  //         new Map([
  //           [
  //             {},
  //             {
  //               title: "WHooooo",
  //               type: "integer",
  //             },
  //           ],
  //         ])
  //       ),
  //     },
  //   };
  // },

  on_screen_compass_plugin,
  // pathfinding_test_plugin,

  variants_plugin,
  serverlinks_plugin,
  announce_joined_game_plugin,
  // resource_pack_3_plugin,
  // xxxx,
  heads_plugin,
  // noth_compass_plugin,
  // bossbar_plugin,
  default_build_plugin,
  ascend_if_falling_plugin,
];
