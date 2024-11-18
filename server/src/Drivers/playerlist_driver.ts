import { Signal } from "signal-polyfill";
import { PlayPackets } from "../minecraft-protocol.ts";
import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { map_difference } from "../packages/immappable.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type ListedPlayer } from "../PluginInfrastructure/Plugin_v1.ts";

export let makePlayerlistDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Map<bigint, ListedPlayer>> => {
  return ({ signal, effect, input$ }) => {
    let listedplayers$ = new Signal.Computed(() => {
      return new Map(input$.get().flatMap((x) => Array.from(x.entries())));
    });

    let _sent_listed_players = new Map<bigint, ListedPlayer>();
    effect(() => {
      let { added, stayed, removed } = map_difference(
        _sent_listed_players,
        listedplayers$.get()
      );
      _sent_listed_players = listedplayers$.get();

      if (added.size > 0) {
        minecraft_socket.send(
          PlayPackets.clientbound.player_info_update.write({
            actions: {
              type: new Set([
                "add_player",
                "update_listed",
                "update_game_mode",
                "update_latency",
                "update_display_name",
              ]),
              value: Array.from(added.entries()).map(([uuid, player]) => ({
                uuid: uuid,
                actions: {
                  add_player: {
                    name: player.name,
                    properties: player.properties,
                  },
                  update_listed: player.listed,
                  update_game_mode: player.game_mode,
                  update_latency: player.ping,
                  update_display_name: player.display_name,

                  /// HEHEHEHEHE
                  initialize_chat: null as any,
                },
              })),
            },
          })
        );
      }

      if (stayed.size > 0) {
        for (let [uuid, [from, to]] of stayed.entries()) {
          if (from !== to) {
            console.log(`to:`, to);
            minecraft_socket.send(
              PlayPackets.clientbound.player_info_update.write({
                actions: {
                  type: new Set([
                    "update_listed",
                    "update_game_mode",
                    "update_latency",
                    "update_display_name",
                  ]),
                  value: Array.from(stayed.entries()).map(([uuid, player]) => ({
                    uuid: uuid,
                    actions: {
                      update_game_mode: to.game_mode,
                      update_latency: to.ping,
                      update_display_name: to.display_name,

                      /// :$
                      add_player: null as any,
                      update_listed: null as any,
                      initialize_chat: null as any,
                    },
                  })),
                },
              })
            );
          }
        }
        /// TODO do updates later
      }

      if (removed.size > 0) {
        minecraft_socket.send(
          PlayPackets.clientbound.player_info_remove.write({
            uuids: Array.from(removed.keys()),
          })
        );
      }
    });
  };
};
