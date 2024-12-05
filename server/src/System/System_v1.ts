import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";
import { type Vec3 } from "../utils/vec3.ts";
import { Component, EntityRegistry, OptionalComponent } from "./ECS.ts";

export type ComponentAnimation = {
  animation: string;
  ticks: number;
};

export class PositionComponent extends Component<Position> {}
export class VelocityComponent extends Component<Vec3> {}
export class GravityComponent extends Component<void> {}
export class RenderComponent extends Component<{
  type: RegistryResourceKey<"minecraft:entity_type">;
}> {}
export class RotationComponent extends Component<{
  yaw: number;
  pitch: number;
  animation?: ComponentAnimation;
}> {}
export class HeadrotationComponent extends Component<{ yaw: number }> {}

export class GrazeComponent extends Component<{
  last_change_ticks_ago: number;
  is_grazing: boolean;
}> {}
export class WalkrandomlyComponent extends Component<{
  last_random_walk: number;
  target: null | Vec3;
}> {}

// entities.addEntity("1", [
//   new PositionComponent({ x: 10, y: 10, z: 10 }),
//   new VelocityComponent({ x: 0, y: 0, z: 0 }),
//   new GravityComponent(),
//   new RenderComponent("minecraft:polar_bear")
// ]);
// entities.addEntity("2", [
//   new PositionComponent({ x: 20, y: 20, z: 10 }),
//   new VelocityComponent({ x: 0, y: 0, z: 0 }),
//   new GravityComponent(),
//   new RenderComponent("minecraft:polar_bear")
// ]);
// entities.addEntity("3", [
//   new PositionComponent({ x: 30, y: 30, z: 10 }),
//   new VelocityComponent({ x: 0, y: 0, z: 0 }),
//   new RenderComponent("minecraft:polar_bear")
// ]);

// let with_position = entities.query([
//   PositionComponent,
//   new OptionalComponent(GravityComponent),
// ]);

// for (let [id, position, gravity] of with_position) {
//   console.log(id, position, gravity);
// }
