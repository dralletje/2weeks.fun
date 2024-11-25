import { Signal } from "signal-polyfill";
import {
  type Plugin_v1,
  type ListedPlayer,
  type Plugin_v1_Args,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { type Entity } from "../Drivers/entities_driver.ts";
import { World } from "../PluginInfrastructure/World.ts";

export default function show_other_players_plugin({
  player,
  world,
}: Plugin_v1_Args & {
  world: World;
}): Plugin_v1 {
  let listed_players$ = new Signal.Computed((): Map<bigint, ListedPlayer> => {
    let other_players = Array.from(world.players.get()).filter(
      ([uuid, other_player]) => other_player !== player
    );

    return new Map([
      ...other_players.map(([uuid, other_player]): [bigint, ListedPlayer] => {
        return [
          uuid,
          {
            name: other_player.name,
            properties:
              other_player.texture != null
                ? [
                    {
                      name: "textures",
                      value: other_player.texture.value,
                      signature: other_player.texture.signature,
                    },
                  ]
                : [],
            listed: true,
            game_mode: "creative",
            ping: 0,
            display_name: null,
          },
        ];
      }),
    ]);
  });

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    let other_players = Array.from(world.players.get()).filter(
      ([uuid, other_player]) => other_player !== player
    );

    return new Map(
      other_players.map(([uuid, other_player]): [bigint, Entity] => {
        return [
          uuid,
          {
            type: "minecraft:player",
            position: {
              x: other_player.position.x,
              y: other_player.position.y,
              z: other_player.position.z,
            },
            // x: player.position.x,
            // y: player.position.y,
            // z: player.position.z + 2,

            pitch: other_player.position.pitch,
            yaw: other_player.position.yaw,
            head_yaw: other_player.position.yaw,
            data: 0,
            velocity_x: 0,
            velocity_y: 0,
            velocity_z: 0,

            equipment: {
              main_hand: {
                item: "minecraft:stick",
                count: 1,
              },
            },
          },
        ];
      })
    );
  });

  return {
    sinks: {
      entities$: entities$,
      playerlist$: listed_players$,
    },
    commands: [],
  };
}
