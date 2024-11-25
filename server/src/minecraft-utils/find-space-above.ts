import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";
import { type World } from "../PluginInfrastructure/World.ts";
import { vec3 } from "../utils/vec3.ts";

export let find_space_above = ({
  world,
  position,
}: {
  world: World;
  position: Position;
}) => {
  let block_position = vec3.floor(position);

  /// Find first solid block
  let solid_above = {
    x: block_position.x,
    y: block_position.y,
    z: block_position.z,
  };
  while (world.get_block({ position: solid_above }).name === "minecraft:air") {
    if (solid_above.y > world.top) {
      return { ...position, y: world.top };
    }

    solid_above = vec3.add(solid_above, { x: 0, y: 1, z: 0 });
  }

  let non_solid = solid_above;
  while (
    world.get_block({ position: non_solid }).name !== "minecraft:air" &&
    world.get_block({
      position: vec3.add(non_solid, { x: 0, y: 1, z: 0 }),
    }).name !== "minecraft:air"
  ) {
    if (non_solid.y > world.top) {
      return { ...position, y: world.top };
    }

    // console.log(`non_solid:`, non_solid);
    non_solid = vec3.add(non_solid, { x: 0, y: 1, z: 0 });
  }

  return non_solid;
};
