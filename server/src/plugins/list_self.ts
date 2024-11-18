import {
  type Plugin_v1_Args,
  type Plugin_v1,
  type ListedPlayer,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { Signal } from "signal-polyfill";

export default function list_self_plugin({
  player,
}: Plugin_v1_Args): Plugin_v1 {
  let self_listed_players$ = new Signal.State(
    new Map<bigint, ListedPlayer>([
      [
        player.uuid.toBigInt(),
        {
          name: player.name,
          properties: player.texture
            ? [
                {
                  name: "textures",
                  value: player.texture.value,
                  signature: player.texture.signature,
                },
              ]
            : [],
          listed: true,
          display_name: null,
          game_mode: "creative",
          ping: 0,
        },
      ],
    ])
  );

  return {
    sinks: {
      playerlist$: self_listed_players$,
    },
  };
}
