import { Signal } from "signal-polyfill";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  entity_uuid_counter,
  type Entity,
} from "../Drivers/entities_driver.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import { vec3 } from "../utils/vec3.ts";
import { regexp } from "../utils/regexp-tag.ts";

let error = (message: string) => {
  throw new Error(message);
};

export default function summon_with_eggs_plugin({
  player,
  signal,
}: Plugin_v1_Args): Plugin_v1 {
  let creepy_entities$ = new MapStateSignal<bigint, Entity>();

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    // let position = position$.get();
    let position = player.position;

    return new Map(
      Array.from(creepy_entities$.get()).map(([uuid, entity]) => {
        let entity_height =
          entity.type === "minecraft:giant"
            ? 12
            : entity.type === "minecraft:enderman"
              ? 2.9
              : entity.type === "minecraft:cat" ||
                  entity.type === "minecraft:allay"
                ? 0.5
                : 1.62;

        /// Pitch from this entity to the player
        let dx = position.x - entity.position.x;
        let dy = position.y + 1.62 - (entity.position.y + entity_height);
        let dz = position.z - entity.position.z;
        let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
        let pitch = Math.asin(dy / distance);
        let yaw = Math.atan2(dx, dz);

        let _pitch = -((pitch / Math.PI) * (256 / 2));
        let yaw2 = modulo_cycle((-yaw / (2 * Math.PI)) * 256, 256);

        return [
          uuid,
          {
            ...entity,
            pitch: _pitch,
            yaw: yaw2,
            head_yaw: yaw2,
          },
        ];
      })
    );
  });

  player.on_interact_v1(
    (event) => {
      if (
        event.target.type !== "block" ||
        event.item == null ||
        event.type !== "interact"
      ) {
        return;
      }

      let spawn_egg_regexp = regexp`^${"minecraft:"}(?<entity_id>.*)${"_spawn_egg"}$`;

      let spawn_egg_match = event.item.item.match(spawn_egg_regexp);
      if (spawn_egg_match == null) {
        return;
      }

      let entity_type = spawn_egg_match.groups!.entity_id as any;

      let position = vec3.add(event.target.position, event.target.cursor);

      let uuid = entity_uuid_counter.get_id();
      let entity = {
        position: {
          x: position.x,
          y: position.y,
          z: position.z,
        },
        pitch: 0,
        yaw: 0,
        head_yaw: 0,
        type: `minecraft:${entity_type}` as any,
        uuid: uuid,
        data: 0,
        velocity_x: 0,
        velocity_y: 0,
        velocity_z: 0,
      } as Entity;
      creepy_entities$.add(uuid, entity);
      return null;
    },
    { signal }
  );

  return {
    sinks: {
      entities$: entities$,
    },
  };
}
