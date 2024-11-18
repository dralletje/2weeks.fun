import { Signal } from "signal-polyfill";
import { TimeSignal } from "../utils/TimeSignal.ts";
import {
  type Plugin_v1,
  type Plugin_v1_Args,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { type Bossbar, bossbars_counter } from "../Drivers/bossbars_driver.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { clamp } from "lodash-es";
// import { MapStateSignal } from "../packages/MapStateSignal.ts";

let async = async (async) => async();

export default function bossbar_plugin({ signal }: Plugin_v1_Args): Plugin_v1 {
  let bossbar = bossbars_counter.get_id();

  let time$ = new TimeSignal(100, { signal });

  // let bossbars$ = new Signal.Computed<Map<bigint, Bossbar>>(() => {
  //   let time_s = time$.get() / 1000;
  //   let health = modulo_cycle(time_s, 1.8) - 0.4;
  //   return new Map([
  //     [
  //       bossbar,
  //       {
  //         title: "Starting server...",
  //         health: clamp(health, 0, 1),
  //         color: "blue",
  //         division: "20 notches",
  //         // flags: new Set(["create_fog"]),
  //         flags: new Set([]),
  //       },
  //     ],
  //   ]);
  // });

  /// Switch between two bossbar ids
  let odd_bossbar = bossbars_counter.get_id();
  let even_bossbar = bossbars_counter.get_id();
  let bossbars$ = new Signal.Computed<Map<bigint, Bossbar>>(() => {
    let time_s = time$.get() / 1000;
    let health = modulo_cycle(time_s, 1.8) - 0.4;

    let cycle_odd_or_even = Math.floor(time_s / 1.8) % 2 === 0;
    let bossbar_id = cycle_odd_or_even ? odd_bossbar : even_bossbar;

    return new Map<bigint, Bossbar>([
      [
        bossbar_id,
        {
          title: "Loading something...",
          health: clamp(health, 0, 1),
          color: "blue",
          division: "none",
          // flags: new Set(["create_fog"]),
          flags: new Set([]),
        },
      ],
    ]);
  });

  return {
    sinks: {
      bossbars$: bossbars$,
    },
  };
}
