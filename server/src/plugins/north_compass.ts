import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { Signal } from "signal-polyfill";

export default function noth_compass_plugin({
  player,
}: Plugin_v1_Args): Plugin_v1 {
  let compass$ = new Signal.Computed(() => {
    let position = player.position;
    return {
      x: position.x,
      y: position.y,
      z: position.z - 10000,
    };
  });

  return {
    sinks: {
      compass$: compass$,
    },
  };
}
