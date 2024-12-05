import { Signal } from "signal-polyfill";
import { chat } from "../utils/chat.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  entity_uuid_counter,
  type Entity,
} from "../Drivers/entities_driver.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { immutable_emplace } from "../packages/immappable.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import {
  GravityComponent,
  GrazeComponent,
  HeadrotationComponent,
  PositionComponent,
  RenderComponent,
  RotationComponent,
  VelocityComponent,
  WalkrandomlyComponent,
} from "../System/System_v1.ts";

export default function spawn_plugin({
  player,
  livingworld,
}: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/spawn ${c.resource("entity_type", "minecraft:entity_type")}`,
        handle: ([entity_type], { player }) => {
          let entity_id = entity_uuid_counter.get_id();

          if (entity_type === "minecraft:player") {
            throw new CommandError(
              chat`Cannot spawn a player, use ${chat.suggest_command(chat.yellow(`/npc create`), "/npc create ")} instead`
            );
          }

          let position = player.position;
          livingworld.addEntity(entity_id, [
            new PositionComponent(position),
            new RenderComponent({ type: entity_type }),
            new GravityComponent(),
            new VelocityComponent({ x: 0, y: 0, z: 0 }),
            new RotationComponent({ yaw: position.yaw, pitch: position.pitch }),
            new HeadrotationComponent({ yaw: position.yaw }),
            new GrazeComponent({ is_grazing: false, last_change_ticks_ago: 0 }),
            new WalkrandomlyComponent({ last_random_walk: 0, target: null }),
          ]);

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Spawned ")}${chat.yellow(entity_type)}`);
        },
      }),
    ],
  };
}
