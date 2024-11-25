import { find_space_above } from "../minecraft-utils/find-space-above.ts";
import { c, command } from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { chat } from "../utils/chat.ts";
import { vec3 } from "../utils/vec3.ts";

export default function navigate_plugin({ world }: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/asc`,
        handle: ([], { player }) => {
          let non_solid = find_space_above({
            world,
            position: player.position,
          });

          player.teleport(
            vec3.add(vec3.floor(non_solid), { x: 0.5, y: 1, z: 0.5 })
          );
          player.send(
            chat`Teleported to ${non_solid.x}, ${non_solid.y}, ${non_solid.z}`
          );
        },
      }),
    ],
  };
}
