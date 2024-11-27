import { Signal } from "signal-polyfill";
import { chat } from "../utils/chat.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  entity_uuid_counter,
  type EntityMetadataMap,
  type Entity,
} from "../Drivers/entities_driver.ts";
import { immutable_emplace } from "../packages/immappable.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import { slot_to_packetable } from "../PluginInfrastructure/BasicPlayer.ts";

let error = (message: string) => {
  throw new Error(message);
};

export default function display_plugin({ player }: Plugin_v1_Args): Plugin_v1 {
  let entities$ = new Signal.State(new Map<bigint, Entity>());

  return {
    sinks: {
      entities$: entities$,
    },
    commands: [
      command({
        command: c.command`/display block ${c.block_state("Block")} huge`,
        handle: ([block], { player }) => {
          let uuid = entity_uuid_counter.get_id();
          let position = player.position;

          entities$.set(
            immutable_emplace(entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: "minecraft:block_display",
                position: {
                  x: position.x,
                  y: position.y,
                  z: position.z,
                },
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                metadata_raw: new Map([
                  [23, { type: "block_state", value: block.state.id }],
                  // [11, { type: "vector3", value: { x: 1, y: 1, z: 1 } }],
                  [12, { type: "vector3", value: { x: 10, y: 10, z: 10 } }],
                ]),
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow(block.name)}`);
        },
      }),

      command({
        command: c.command`/display block ${c.block_state("Block")} x ${c.float("Scale")}`,
        handle: ([block, scale], { player }) => {
          let uuid = entity_uuid_counter.get_id();
          let position = player.position;

          let blockid = block.state.id;

          entities$.set(
            immutable_emplace(entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: "minecraft:block_display",
                position: {
                  x: position.x,
                  y: position.y,
                  z: position.z,
                },
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                metadata_raw: new Map([
                  [23, { type: "block_state", value: blockid }],
                  // [11, { type: "vector3", value: { x: 1, y: 1, z: 1 } }],
                  [
                    12,
                    {
                      type: "vector3",
                      value: { x: scale, y: scale, z: scale },
                    },
                  ],
                ]),
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow("NICE")}`);
        },
      }),

      command({
        command: c.command`/display text ${c.string("Text")}`,
        handle: ([text], { player }) => {
          let uuid = entity_uuid_counter.get_id();
          let position = player.position;

          entities$.set(
            immutable_emplace(entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: "minecraft:text_display",
                position: position,
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                metadata_raw: new Map([
                  [23, { type: "chat", value: text }],
                  [15, { type: "byte", value: 0x03 }],
                  // // [11, { type: "vector3", value: { x: 1, y: 1, z: 1 } }],
                  // [
                  //   12,
                  //   {
                  //     type: "vector3",
                  //     value: { x: scale, y: scale, z: scale },
                  //   },
                  // ],
                ]) satisfies EntityMetadataMap,
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow("NICE")}`);
        },
      }),

      command({
        command: c.command`/display text ${c.string("Text")} ${c.word("Color")}`,
        handle: ([text, color], { player }) => {
          let uuid = entity_uuid_counter.get_id();
          let position = player.position;

          if (!color.startsWith("#")) {
            throw new CommandError("Color must start with #");
          }

          /// Color to number
          let color_number = parseInt(color.slice(1).padEnd(8, "0"), 16);

          entities$.set(
            immutable_emplace(entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: "minecraft:text_display",
                position: position,
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                metadata_raw: new Map([
                  [23, { type: "chat", value: text }],
                  [15, { type: "byte", value: 0x03 }],
                  [25, { type: "varint", value: color_number }],
                  // // [11, { type: "vector3", value: { x: 1, y: 1, z: 1 } }],
                  // [
                  //   12,
                  //   {
                  //     type: "vector3",
                  //     value: { x: scale, y: scale, z: scale },
                  //   },
                  // ],
                ]) satisfies EntityMetadataMap,
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow("NICE")}`);
        },
      }),

      command({
        command: c.command`/display item ${c.resource("item", "minecraft:item")} huge`,
        handle: ([item_type], { player }) => {
          let uuid = entity_uuid_counter.get_id();
          let position = player.position;

          entities$.set(
            immutable_emplace(entities$.get(), uuid, {
              insert: () => ({
                // entity_id: entity_id,
                // entity_uuid: uuid,
                type: "minecraft:item_display",
                position: {
                  x: position.x,
                  y: position.y,
                  z: position.z,
                },
                pitch: position.pitch,
                yaw: position.yaw,
                head_yaw: position.yaw,
                data: 0,
                velocity_x: 10000,
                velocity_y: 0,
                velocity_z: 0,
                metadata_raw: new Map([
                  [
                    23,
                    {
                      type: "slot",
                      value: slot_to_packetable({
                        count: 2,
                        item: item_type,
                      }),
                    },
                  ],
                  // [11, { type: "vector3", value: { x: 1, y: 1, z: 1 } }],
                  [12, { type: "vector3", value: { x: 10, y: 10, z: 10 } }],
                ]),
              }),
            })
          );

          // prettier-ignore
          player.send(chat`${chat.dark_purple("*")} ${chat.gray("Summoned ")}${chat.yellow("NICE")}`);
        },
      }),
    ],
  };
}
