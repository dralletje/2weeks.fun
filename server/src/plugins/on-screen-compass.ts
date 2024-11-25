import { Signal } from "signal-polyfill";
import { type Bossbar, bossbars_counter } from "../Drivers/bossbars_driver.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";

let BOSSBAR_TITLE_SIZE =
  "|                                                          |".length;
let FULL_SIZE = (BOSSBAR_TITLE_SIZE / 3) * 8;
let NOTCHES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
let BOSSBAR_EXPANDED = [...NOTCHES, ...NOTCHES, ...NOTCHES]
  .map((notch) => notch + " ".repeat(BOSSBAR_TITLE_SIZE / 3 - notch.length))
  .join("");

export default function on_screen_compass_plugin({
  position,
}: Plugin_v1_Args): Plugin_v1 {
  let uuid = bossbars_counter.get_id();

  let yaw$ = new Signal.Computed(() => position.position$.get().yaw);

  return {
    sinks: {
      bossbars$: new Signal.Computed(() => {
        let yaw = yaw$.get();

        let notch = Math.round(((yaw - 20) / 360) * FULL_SIZE);

        let start = BOSSBAR_TITLE_SIZE + notch;
        let title = BOSSBAR_EXPANDED.slice(start, start + BOSSBAR_TITLE_SIZE);

        return new Map([
          [
            uuid,
            {
              color: "green",
              division: "6 notches",
              flags: new Set(),
              health: 0,
              title: title,
            } as Bossbar,
          ],
        ]);
      }),
    },
  };
}
