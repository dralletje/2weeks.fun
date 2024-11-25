import { c, command } from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { Signal } from "signal-polyfill";
import { type PlayerState } from "../Drivers/playerstate_driver.ts";

export default function makeEnvironmentPlugin(initial: PlayerState = {}) {
  return ({ world, send_packet }: Plugin_v1_Args): Plugin_v1 => {
    let fullstate$ = new Signal.State<PlayerState>(initial);

    let update = (state: PlayerState) => {
      fullstate$.set({
        ...fullstate$.get(),
        ...state,
      });
    };

    return {
      sinks: { playerstate$: fullstate$ },
      commands: [
        command({
          command: c.command`/environment gamemode survival`,
          handle: () => update({ gamemode: "survival" }),
        }),
        command({
          command: c.command`/environment gamemode creative`,
          handle: () => update({ gamemode: "creative" }),
        }),
        command({
          command: c.command`/environment gamemode adventure`,
          handle: () => update({ gamemode: "adventure" }),
        }),
        command({
          command: c.command`/environment gamemode spectator`,
          handle: () => update({ gamemode: "spectator" }),
        }),

        command({
          command: c.command`/environment allow_flying ${c.boolean("Allow Flying")}`,
          handle: ([value]) => update({ allow_flying: value }),
        }),
        command({
          command: c.command`/environment creative ${c.boolean("Creative")}`,
          handle: ([value]) => update({ creative: value }),
        }),
        command({
          command: c.command`/environment flying ${c.boolean("Flying")}`,
          handle: ([value]) => update({ flying: value }),
        }),
        command({
          command: c.command`/environment raining ${c.boolean("Raining")}`,
          handle: ([value]) => update({ raining: value }),
        }),
        command({
          command: c.command`/environment invulnerable ${c.boolean("Invulnerable")}`,
          handle: ([value]) => update({ invulnerable: value }),
        }),

        command({
          command: c.command`/environment rain_level ${c.float("0 - 1")}`,
          handle: ([value]) => update({ rain_level: value }),
        }),
        command({
          command: c.command`/environment thunder_level ${c.float("0 - 1")}`,
          handle: ([value]) => update({ thunder_level: value }),
        }),

        command({
          command: c.command`/environment experiencebar ${c.float("0 - 1")}`,
          handle: ([value]) => update({ experiencebar: value }),
        }),
        command({
          command: c.command`/environment level ${c.integer("Level")}`,
          handle: ([value]) => update({ level: value }),
        }),
        command({
          command: c.command`/environment food ${c.integer("0 - 20")}`,
          handle: ([value]) => update({ food: value }),
        }),
        command({
          command: c.command`/environment health ${c.integer("0 - 20")}`,
          handle: ([value]) => update({ health: value }),
        }),
        command({
          command: c.command`/environment field_of_view_modifier ${c.float("FOV")}`,
          handle: ([value]) => update({ field_of_view_modifier: value }),
        }),
        command({
          command: c.command`/environment flying_speed ${c.float("Flying Speed")}`,
          handle: ([value]) => update({ flying_speed: value }),
        }),

        command({
          command: c.command`/environment time ${c.integer("0 - 24000")}`,
          handle: ([value]) =>
            update({ time: { time: BigInt(value), locked: false } }),
        }),
        command({
          command: c.command`/environment time ${c.integer("0 - 24000")} locked`,
          handle: ([value]) =>
            update({ time: { time: BigInt(value), locked: true } }),
        }),

        command({
          command: c.command`/environment doImmediateRespawn ${c.boolean("Immediate Respawn")}`,
          handle: ([value]) => update({ doImmediateRespawn: value }),
        }),
        command({
          command: c.command`/environment doReduceDebugInfo ${c.boolean("Reduced Debug Info")}`,
          handle: ([value]) => update({ reduced_debug_info: value }),
        }),
        command({
          command: c.command`/environment doLimitedCrafting ${c.boolean("Show Death Screen")}`,
          handle: ([value]) => update({ doLimitedCrafting: value }),
        }),

        command({
          command: c.command`/environment op 1`,
          handle: () => update({ op: 0 }),
        }),
        command({
          command: c.command`/environment op 1`,
          handle: () => update({ op: 1 }),
        }),
        command({
          command: c.command`/environment op 2`,
          handle: () => update({ op: 2 }),
        }),
        command({
          command: c.command`/environment op 3`,
          handle: () => update({ op: 3 }),
        }),
        command({
          command: c.command`/environment op 4`,
          handle: () => update({ op: 4 }),
        }),
      ],
    };
  };
}
