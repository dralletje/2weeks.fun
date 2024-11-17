import { Signal } from "signal-polyfill";
import {
  bossbar_color,
  bossbar_flags,
  bossbar_notches,
  PlayPackets,
} from "../minecraft-protocol.ts";
import { type ValueOfProtocol } from "../protocol.ts";
import { type AnySignal, effect } from "../signals.ts";
import { differenceBy, intersectionBy, isEqual } from "lodash-es";
import { map_difference } from "../immappable.ts";

export type Bossbar = {
  title: string;
  health: number;
  color: ValueOfProtocol<typeof bossbar_color>;
  division: ValueOfProtocol<typeof bossbar_notches>;
  flags: ValueOfProtocol<typeof bossbar_flags>;
};

export let bossbars_synchronizer = ({
  writer,
  bossbars$,
}: {
  writer: WritableStreamDefaultWriter;
  bossbars$: AnySignal<Map<bigint, Bossbar>>;
}) => {
  // let bossbars$ = new Signal.State<Array<Bossbar>>([]);
  let _current_bossbars = new Map<bigint, Bossbar>();
  effect(async () => {
    let expected_bossbars = bossbars$.get();

    let changes = map_difference(_current_bossbars, expected_bossbars);

    _current_bossbars = expected_bossbars;

    for (let [uuid, bossbar] of changes.removed) {
      await writer.write(
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
      await writer.write(
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
        await writer.write(
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
        await writer.write(
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
        await writer.write(
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
        await writer.write(
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
