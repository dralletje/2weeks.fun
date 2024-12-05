import { range } from "lodash-es";
import { World } from "../PluginInfrastructure/World.ts";
import { EntityRegistry } from "../System/ECS.ts";
import {
  GravityComponent,
  GrazeComponent,
  HeadrotationComponent,
  PositionComponent,
  RotationComponent,
  VelocityComponent,
  WalkrandomlyComponent,
} from "../System/System_v1.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";
import { TAU } from "../utils/tau.ts";

export let grazing_system = ({
  world,
  livingworld,
}: {
  world: World;
  livingworld: EntityRegistry;
}) => {
  let entities = livingworld.query([
    RotationComponent,
    HeadrotationComponent,
    GrazeComponent,
  ]);

  for (let [id, rotation, head_rotation, grazing] of entities) {
    if (grazing.data.is_grazing) {
      if (grazing.data.last_change_ticks_ago > 50) {
        livingworld.updateComponents(id, [
          new GrazeComponent({
            is_grazing: false,
            last_change_ticks_ago: 0,
          }),
          new RotationComponent({
            yaw: rotation.data.yaw,
            pitch: 0.01 * TAU,
          }),
        ]);
      } else {
        livingworld.updateComponents(id, [
          new GrazeComponent({
            is_grazing: true,
            last_change_ticks_ago: grazing.data.last_change_ticks_ago + 1,
          }),
        ]);
      }
    } else {
      if (Math.random() < 0.01) {
        livingworld.updateComponents(id, [
          new GrazeComponent({
            is_grazing: true,
            last_change_ticks_ago: grazing.data.last_change_ticks_ago + 1,
          }),
          new RotationComponent({
            yaw: rotation.data.yaw,
            pitch: -0.15 * TAU,
          }),
        ]);
      }
    }
  }
};

export let walk_randomly = ({
  world,
  livingworld,
}: {
  world: World;
  livingworld: EntityRegistry;
}) => {
  let entities = livingworld.query([
    RotationComponent,
    PositionComponent,
    WalkrandomlyComponent,
    VelocityComponent,
    GrazeComponent,
  ]);

  for (let [
    id,
    rotation,
    position,
    walkrandomly,
    velocity,
    graze,
  ] of entities) {
  }
};
