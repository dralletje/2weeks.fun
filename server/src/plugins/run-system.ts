import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { TickSignal } from "../utils/TimeSignal.ts";
import { EntityRegistry } from "../System/ECS.ts";
import { effectWithSignal } from "../utils/signals.ts";
import { World } from "../PluginInfrastructure/World.ts";

export default function run_systems_plugins(
  systems: Array<(input: { world: World; livingworld: EntityRegistry }) => void>
) {
  return ({ livingworld, signal, world }: Plugin_v1_Args): Plugin_v1 => {
    let ticks$ = new TickSignal(50, { signal });

    effectWithSignal(signal, () => {
      ticks$.get();

      for (let system of systems) {
        // console.log(`system:`, system);
        system({
          world,
          livingworld,
        });
      }
    });

    return {};
  };
}
