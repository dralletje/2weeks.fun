import { isEqual } from "lodash-es";
import { Signal } from "signal-polyfill";
import {
  bossbar_color,
  bossbar_flags,
  bossbar_notches,
  PlayPackets,
} from "../minecraft-protocol.ts";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { map_difference } from "../packages/immappable.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type ValueOfProtocol } from "../protocol.ts";
import { BigIntCounter } from "../Unique.ts";

export type Bossbar = {
  title: string;
  health: number;
  color: ValueOfProtocol<typeof bossbar_color>;
  division: ValueOfProtocol<typeof bossbar_notches>;
  flags: ValueOfProtocol<typeof bossbar_flags>;
};

export let bossbars_counter = new BigIntCounter();

export let makeBossbarsDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Map<bigint, Bossbar>> => {
  return ({ input$, effect, signal }) => {
    let bossbars$ = new Signal.Computed(() => {
      return new Map(input$.get().flatMap((x) => Array.from(x.entries())));
    });
    let _current_bossbars = new Map<bigint, Bossbar>();

    effect(async () => {
      let expected_bossbars = bossbars$.get();

      let changes = map_difference(_current_bossbars, expected_bossbars);

      _current_bossbars = expected_bossbars;

      for (let [uuid, bossbar] of changes.removed) {
        minecraft_socket.send(
          PlayPackets.clientbound.boss_event.write({
            uuid: uuid,
            action: {
              type: "remove",
              value: undefined,
            },
          })
        );
      }
      for (let [uuid, bossbar] of changes.added) {
        minecraft_socket.send(
          PlayPackets.clientbound.boss_event.write({
            uuid: uuid,
            action: {
              type: "add",
              value: {
                title: bossbar.title,
                health: bossbar.health,
                color: bossbar.color,
                division: bossbar.division,
                flags: bossbar.flags,
              },
            },
          })
        );
      }
      for (let [uuid, [prev, next]] of changes.stayed) {
        if (prev.health !== next.health) {
          minecraft_socket.send(
            PlayPackets.clientbound.boss_event.write({
              uuid: uuid,
              action: {
                type: "update_health",
                value: {
                  health: next.health,
                },
              },
            })
          );
        }
        if (prev.title !== next.title) {
          minecraft_socket.send(
            PlayPackets.clientbound.boss_event.write({
              uuid: uuid,
              action: {
                type: "update_title",
                value: {
                  title: next.title,
                },
              },
            })
          );
        }
        if (prev.color !== next.color || prev.division !== next.division) {
          minecraft_socket.send(
            PlayPackets.clientbound.boss_event.write({
              uuid: uuid,
              action: {
                type: "update_style",
                value: {
                  color: next.color,
                  division: next.division,
                },
              },
            })
          );
        }
        if (!isEqual(prev.flags, next.flags)) {
          minecraft_socket.send(
            PlayPackets.clientbound.boss_event.write({
              uuid: uuid,
              action: {
                type: "update_flags",
                value: next.flags,
              },
            })
          );
        }
      }
    });
  };
};
