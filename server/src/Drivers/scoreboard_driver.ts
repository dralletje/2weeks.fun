import { Signal } from "signal-polyfill";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { emplace, map_difference } from "../packages/immappable.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import {
  type TextComponent,
  type TextComponentStyle,
} from "../protocol/text-component.ts";
import { v4 } from "uuid";

export type ScoreboardObjective = {
  title: TextComponent | string;
  type: "integer" | "hearts";
  value: number;
  format?:
    | { type: "blank" }
    | { type: "styled"; style: TextComponentStyle }
    | { type: "fixed"; text: TextComponent };
};

export let makeScoreboardDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Map<WeakKey, ScoreboardObjective>> => {
  return ({ signal, effect, input$ }) => {
    let objectives$ = new Signal.Computed(() => {
      return new Map(input$.get().flatMap((x) => Array.from(x.entries())));
    });

    let _sent_objectives = new Map<WeakKey, ScoreboardObjective>();

    let _objectives_to_name = new Map<WeakKey, string>();

    effect(() => {
      let { added, stayed, removed } = map_difference(
        _sent_objectives,
        objectives$.get()
      );
      _sent_objectives = objectives$.get();

      for (let [key, objective] of added.entries()) {
        let name = emplace(_objectives_to_name, key, {
          insert: () => v4(),
        });
        minecraft_socket.send(
          PlayPackets.clientbound.set_objective.write({
            objective_name: name,
            action: {
              type: "create",
              value: {
                type: objective.type,
                format: null,
                objective_value: objective.title,
              },
            },
          })
        );
        minecraft_socket.send(
          PlayPackets.clientbound.set_display_objective.write({
            objective_name: name,
            position: "sidebar",
          })
        );
        minecraft_socket.send(
          PlayPackets.clientbound.set_score.write({
            objective_name: name,
            title: "1111",
            entity_name: "Hmmm",
            value: 10,
            format: undefined,
          })
        );
      }

      // if (stayed.size > 0) {
      //   for (let [uuid, [from, to]] of stayed.entries()) {
      //     if (from !== to) {
      //       minecraft_socket.send(
      //         PlayPackets.clientbound.player_info_update.write({
      //           actions: {
      //             type: new Set([
      //               "update_listed",
      //               "update_game_mode",
      //               "update_latency",
      //               "update_display_name",
      //             ]),
      //             value: Array.from(stayed.entries()).map(([uuid, player]) => ({
      //               uuid: uuid,
      //               actions: {
      //                 update_game_mode: to.game_mode,
      //                 update_latency: to.ping,
      //                 update_display_name: to.display_name,

      //                 /// :$
      //                 add_player: null as any,
      //                 update_listed: null as any,
      //                 initialize_chat: null as any,
      //               },
      //             })),
      //           },
      //         })
      //       );
      //     }
      //   }
      // }

      // if (removed.size > 0) {
      //   minecraft_socket.send(
      //     PlayPackets.clientbound.player_info_remove.write({
      //       uuids: Array.from(removed.keys()),
      //     })
      //   );
      // }
    });
  };
};
