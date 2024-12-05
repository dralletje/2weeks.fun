import { range } from "lodash-es";
import { World } from "../PluginInfrastructure/World.ts";
import { EntityRegistry } from "../System/ECS.ts";
import {
  GravityComponent,
  PositionComponent,
  VelocityComponent,
} from "../System/System_v1.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";

let nonsolid = new Set([
  "minecraft:air",
  "minecraft:sugar_cane",
  "minecraft:water",
  "minecraft:tall_grass",
  "minecraft:short_grass",
  "minecraft:rose_bush",
]);

// let HITBOXES: { [type in RegistryResourceKey]: { width: number, height: number }} = {}

let blocks_entity_is_resting_on = (position: Vec3, hitbox_width: number) => {
  let hitbox_radius = hitbox_width / 2;
  let in_block = vec3.subtract(position, vec3.floor(position));
  return [
    in_block.z < hitbox_radius && { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 0 },
    in_block.z > 1 - hitbox_radius && { x: 0, y: 0, z: 1 },
    in_block.x > 1 - hitbox_radius &&
      in_block.z < hitbox_radius && { x: 1, y: 0, z: -1 },
    in_block.x > 1 - hitbox_radius && { x: 1, y: 0, z: 0 },
    in_block.x > 1 - hitbox_radius &&
      in_block.z > 1 - hitbox_radius && { x: 1, y: 0, z: 1 },
    in_block.x < hitbox_radius &&
      in_block.z < hitbox_radius && { x: -1, y: 0, z: -1 },
    in_block.x < hitbox_radius && { x: -1, y: 0, z: 0 },
    in_block.x < hitbox_radius &&
      in_block.z > 1 - hitbox_radius && { x: -1, y: 0, z: 1 },
  ].filter((x) => x !== false);
};

let can_fall = ({
  blocks_resting_on,
  world,
  position,
}: {
  blocks_resting_on: Array<{ x: number; y: number; z: number }>;
  world: World;
  position: Vec3;
}) => {
  for (let i of range(1, Math.max(position.y - world.bottom, 0))) {
    for (let block of blocks_resting_on) {
      let pos = vec3.add(position, { x: block.x, y: -i, z: block.z });
      let block_below = world.get_block({
        position: vec3.floor(pos),
      });
      if (i < world.bottom) {
        throw new Error("AAAAAA");
      }
      if (!nonsolid.has(block_below.name)) {
        return i - 1 + (position.y % 1);
      }
    }
  }
  return 0;
};

export let apply_velocity_system = ({
  world,
  livingworld,
}: {
  world: World;
  livingworld: EntityRegistry;
}) => {
  let entities = livingworld.query([PositionComponent, VelocityComponent]);

  for (let [id, position, velocity] of entities) {
    let new_position = {
      x: position.data.x + velocity.data.x,
      y: position.data.y + velocity.data.y,
      z: position.data.z + velocity.data.z,
    };

    livingworld.updateComponents(id, [
      new PositionComponent(new_position),
      velocity,
    ]);
  }
};

let PLAYER_HITBOX_WIDTH = 0.6;

export let gravity_system = ({
  world,
  livingworld,
}: {
  world: World;
  livingworld: EntityRegistry;
}) => {
  let entities = livingworld.query([
    PositionComponent,
    VelocityComponent,
    GravityComponent,
  ]);

  for (let [id, position, velocity, gravity] of entities) {
    let blocks_resting_on = blocks_entity_is_resting_on(
      position.data,
      PLAYER_HITBOX_WIDTH
    );
    let fall_distance = can_fall({
      blocks_resting_on,
      world,
      position: position.data,
    });

    let vertical_velocity = {
      x: 0,
      y: velocity.data.y,
      z: 0,
    };
    let y_velocity = vec3.multiply(
      vec3.add(vertical_velocity, { x: 0, y: -0.08, z: 0 }),
      0.98
    );

    let new_velocity = {
      x: velocity.data.x,
      y: Math.max(y_velocity.y, -fall_distance),
      z: velocity.data.z,
    };

    livingworld.updateComponents(id, [
      position,
      new VelocityComponent(new_velocity),
    ]);
  }
};
