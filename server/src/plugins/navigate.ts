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
          let block_position = vec3.floor(player.position);

          /// Find first solid block
          let solid_above = {
            x: block_position.x,
            y: block_position.y,
            z: block_position.z,
          };
          while (
            world.get_block({ position: solid_above }).name === "minecraft:air"
          ) {
            // console.log(`solid_above:`, solid_above);
            solid_above = vec3.add(solid_above, { x: 0, y: 1, z: 0 });
          }

          let non_solid = solid_above;
          while (
            world.get_block({ position: non_solid }).name !== "minecraft:air" &&
            world.get_block({
              position: vec3.add(non_solid, { x: 0, y: 1, z: 0 }),
            }).name !== "minecraft:air"
          ) {
            // console.log(`non_solid:`, non_solid);
            non_solid = vec3.add(non_solid, { x: 0, y: 1, z: 0 });
          }

          player.teleport(vec3.add(non_solid, { x: 0.5, y: 1, z: 0.5 }));
          player.send(
            chat`Teleported to ${non_solid.x}, ${non_solid.y}, ${non_solid.z}`
          );
        },
      }),
    ],
  };
}
