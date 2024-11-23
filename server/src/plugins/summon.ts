import { Signal } from "signal-polyfill";
import { chat } from "../utils/chat.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { type Entity } from "../Drivers/entities_driver.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { entity_uuid_counter } from "../Unique.ts";
import { registries } from "@2weeks/minecraft-data";
import { parse as parse_uuid } from "uuid";
import { immutable_emplace } from "../packages/immappable.ts";
import { bytes } from "../protocol.ts";
import { c, command } from "../PluginInfrastructure/Commands_v1.ts";

let error = (message: string) => {
  throw new Error(message);
};

export default function summon_plugin({ player }: Plugin_v1_Args): Plugin_v1 {
  let creepy_entities$ = new Signal.State(new Map<bigint, Entity>());

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
        let dx = position.x - entity.x;
        let dy = position.y + 1.62 - (entity.y + entity_height);
        let dz = position.z - entity.z;
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

  return {
    sinks: {
      entities$: entities$,
    },
    commands: [
      command({
        command: c.command`/summon ${c.resource("entity_type", "minecraft:entity_type")}`,
        handle: ([entity_type], { player }) => {
          let entity_id = entity_uuid_counter.get_id();
          // let entity_type =
          //   registries["minecraft:entity_type"].entries[_entity_type] != null
          //     ? _entity_type
          //     : // prettier-ignore
          //       registries["minecraft:entity_type"].entries[`minecraft:${_entity_type}`] != null
          //       ? `minecraft:${_entity_type}`
          //       : error(`Unknown entity type: ${_entity_type}`);
          let uuid =
            entity_type === "minecraft:player"
              ? bytes.uint128.decode(
                  parse_uuid("069a79f4-24e9-4726-a5be-fca90e38aaf5")
                )[0]
              : BigInt(entity_id);
          let position = player.position;

          creepy_entities$.set(
            immutable_emplace(creepy_entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: entity_type,
                x: position.x,
                y: position.y,
                z: position.z,
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                equipment: {
                  main_hand: {
                    item: "minecraft:diamond_sword",
                    count: 1,
                    rarity: "epic",
                    lore: ["Excalibur"],
                  },
                  off_hand: {
                    item: "minecraft:shield",
                    count: 1,
                    rarity: "epic",
                    lore: ["Excalibur"],
                  },
                  chestplate: {
                    item: "minecraft:chainmail_chestplate",
                    count: 1,
                    rarity: "epic",
                    lore: ["Excalibur"],
                  },
                },
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow(entity_type)}`);
        },
      }),
      command({
        command: c.command`/fov ${c.float("value")}`,
        handle: ([value], { player }) => {
          player.fov = value;

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Field of view set to ")}${chat.yellow(value)}`);
        },
      }),
    ],
  };
}
