import {
  type BlockDefinition,
  type BlockState,
  blocks,
  get_block_by_definition,
  get_block_by_properties,
  require_block_by_properties,
} from "@2weeks/minecraft-data";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { chat } from "../utils/chat.ts";
import { vec2, type Vec2, type Vec3, vec3 } from "../utils/vec3.ts";
import { floor, isEqual } from "lodash-es";
import {
  type Face,
  type CardinalDirection,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { json_to_nbtish } from "../protocol/nbt-json.ts";
import { PlayPackets } from "../minecraft-protocol.ts";
import { builders_by_block_type } from "./build/build.ts";

let Faces = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

let directions3D: Record<Direction3D, Vec3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};
let HERE: Vec3 = { x: 0, y: 0, z: 0 };

let cardinal_based_on_cursor = (cursor: Vec3): CardinalDirection => {
  let D1 =
    cursor.x + cursor.z > 1 ? ("LEFT_TOP" as const) : ("RIGHT_BOTTOM" as const);
  let D2 =
    cursor.x > cursor.z ? ("LEFT_BOTTOM" as const) : ("RIGHT_TOP" as const);
  let cardinal: CardinalDirection =
    D1 === "LEFT_TOP" && D2 === "LEFT_BOTTOM"
      ? "east"
      : D1 === "RIGHT_BOTTOM" && D2 === "RIGHT_TOP"
        ? "west"
        : D1 === "LEFT_TOP" && D2 === "RIGHT_TOP"
          ? "south"
          : "north";
  return cardinal;
};

let rotation_based_on_cursor = (cursor: Vec3): string => {
  let unit_circle_x = cursor.x * 2 - 1;
  let unit_circle_z = cursor.z * 2 - 1;

  let angle = Math.atan2(unit_circle_z, unit_circle_x) / (2 * Math.PI) + 0.5;
  let rotation = (Math.round(angle * 16) + 12) % 16;

  return String(rotation);
};

let reverse_cardinal = (cardinal: CardinalDirection): CardinalDirection => {
  switch (cardinal) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "east":
      return "west";
    case "west":
      return "east";
  }
};

type Direction3D = "north" | "south" | "east" | "west" | "up" | "down";
let reverse_direction_3d = (cardinal: Direction3D): Direction3D => {
  switch (cardinal) {
    case "north":
      return "south";
    case "south":
      return "north";
    case "east":
      return "west";
    case "west":
      return "east";
    case "up":
      return "down";
    case "down":
      return "up";
  }
};

// type Builder = {
//   build?: (change: {
//     definition: BlockDefinition;
//     current_blockstate: BlockState;
//     position_clicked: Vec3;
//     face: Face;
//     cursor: Vec3;
//     get_block: (relative_position: Vec3) => any;
//   }) => Array<{
//     position: Vec3;
//     block: BlockState;
//   }>;
//   destroy?: (change: {
//     block: {
//       name: string;
//       blockstate: BlockState;
//       block: BlockDefinition;
//     };
//     face: Face;
//     get_block: (relative_position: Vec3) => any;
//   }) => Array<{
//     position: Vec3;
//     block: BlockState;
//   }>;
// };

// let builders_by_block_type: { [key: string]: Builder } = {
//   "minecraft:tall_flower": {
//     build: ({
//       definition,
//       current_blockstate,
//       position_clicked,
//       face,
//       cursor,
//       get_block,
//     }) => {
//       let above = get_block(directions3D.up);

//       return [
//         {
//           position: HERE,
//           block: require_block_by_properties(definition, {
//             half: "lower",
//           }),
//         },
//         {
//           position: directions3D.up,
//           block: require_block_by_properties(definition, {
//             half: "upper",
//           }),
//         },
//       ];
//     },
//     destroy: ({ block, face, get_block }) => {
//       let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;
//       if (block.blockstate.properties!.half === "upper") {
//         let below = get_block(directions3D.down);
//         if (
//           below.name === block.name &&
//           below.blockstate.properties!.half === "lower"
//         ) {
//           return [
//             { position: HERE, block: AIR },
//             { position: directions3D.down, block: AIR },
//           ];
//         } else {
//           return [{ position: HERE, block: AIR }];
//         }
//       } else {
//         let above = get_block(directions3D.up);
//         if (
//           above.name === block.name &&
//           above.blockstate.properties!.half === "upper"
//         ) {
//           return [
//             { position: HERE, block: AIR },
//             { position: directions3D.up, block: AIR },
//           ];
//         } else {
//           return [{ position: HERE, block: AIR }];
//         }
//       }
//     },
//   },
//   "minecraft:double_plant": {
//     build: ({
//       definition,
//       current_blockstate,
//       position_clicked,
//       face,
//       cursor,
//       get_block,
//     }) => {
//       let above = get_block(directions3D.up);

//       return [
//         {
//           position: HERE,
//           block: require_block_by_properties(definition, {
//             half: "lower",
//           }),
//         },
//         {
//           position: directions3D.up,
//           block: require_block_by_properties(definition, {
//             half: "upper",
//           }),
//         },
//       ];
//     },
//     destroy: ({ block, face, get_block }) => {
//       let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;
//       if (block.blockstate.properties!.half === "upper") {
//         let below = get_block(directions3D.down);
//         if (
//           below.name === block.name &&
//           below.blockstate.properties!.half === "lower"
//         ) {
//           return [
//             { position: HERE, block: AIR },
//             { position: directions3D.down, block: AIR },
//           ];
//         } else {
//           return [{ position: HERE, block: AIR }];
//         }
//       } else {
//         let above = get_block(directions3D.up);
//         if (
//           above.name === block.name &&
//           above.blockstate.properties!.half === "upper"
//         ) {
//           return [
//             { position: HERE, block: AIR },
//             { position: directions3D.up, block: AIR },
//           ];
//         } else {
//           return [{ position: HERE, block: AIR }];
//         }
//       }
//     },
//   },
//   "minecraft:trapdoor": {
//     build: ({ definition, face, cursor }) => {
//       if (face === "bottom" || face === "top") {
//         let state = require_block_by_properties(definition, {
//           half: face === "bottom" ? "top" : "bottom",
//           facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
//           open: "false",
//         });
//         return [
//           {
//             position: HERE,
//             block: state,
//           },
//         ];
//       } else {
//         let state = require_block_by_properties(definition, {
//           half: cursor.y > 0.5 ? "top" : "bottom",
//           facing: cardinal_based_on_cursor(cursor),
//           open: 0.25 < cursor.y && cursor.y < 0.75 ? "true" : "false",
//         });
//         return [
//           {
//             position: HERE,
//             block: state,
//           },
//         ];
//       }
//     },
//   },
// };

export default function default_build_plugin({
  player,
  signal,
  world,
  send_packet,
  signui,
}: Plugin_v1_Args): Plugin_v1 {
  player.on_interact_v1(
    (event) => {
      if (event.target.type !== "block") {
        return;
      }

      if (event.type === "interact") {
        let {
          target: { position, type, face, cursor },
          item,
        } = event;

        let face_vector = Faces[face];

        let inventory = player.hotbar$.get();
        let slot = inventory[player.selected_hotbar_slot$.get()];

        let floor_wall_ceiling =
          face === "top" ? "floor" : face === "bottom" ? "ceiling" : "wall";

        if (slot) {
          // console.log(`slot.item:`, slot.item);

          let block = blocks[slot.item];
          if (slot.item === "minecraft:water_bucket") {
            block = blocks["minecraft:water"];
          } else if (slot.item === "minecraft:lava_bucket") {
            block = blocks["minecraft:lava"];
          }

          if (block == null) {
            player.send(
              chat`${chat.dark_purple("*")} ${chat.gray("Unknown block: ")}${chat.yellow(slot.item)}`
            );
            return;
          }

          // console.log(`block.definition:`, block.definition);
          // console.log(`block.properties:`, block.properties);

          let block_position = {
            x: position.x + face_vector.x,
            y: position.y + face_vector.y,
            z: position.z + face_vector.z,
          };

          let player_position = player.position;

          let center_of_block = [
            block_position.x + 0.5,
            block_position.z + 0.5,
          ] as Vec2;

          if (
            floor(player_position.y) === block_position.y &&
            vec2.length(
              vec2.subtract(center_of_block, vec3.xz(player_position))
            ) < 1
          ) {
            player.teleport({
              ...player_position,
              y: block_position.y + 1,
            });
          }

          let default_state = block.states.find((x) => x.default);

          if (default_state == null) {
            throw new Error("No default state??");
          }
          /// Turns out "TOP" is south

          let direction_3d: Direction3D =
            face === "top" ? "up" : face === "bottom" ? "down" : face;

          let yaw = player_position.yaw;
          let state = default_state.id ?? 0;

          let builders_for_block_type =
            builders_by_block_type[block.definition.type];
          if (builders_for_block_type?.build) {
            let current_block = world.get_block({ position: position });
            let to_build = builders_for_block_type.build({
              definition: block,
              current_blockstate: current_block.blockstate,
              position_clicked: position,
              face,
              cursor,
              get_block: (relative_position) =>
                world.get_block({
                  position: vec3.add(position, relative_position),
                }),
            });

            for (let { position, block } of to_build) {
              let block = world.get_block({
                position: vec3.add(block_position, position),
              });
              if (block.name !== "minecraft:air") {
                return;
              }
            }

            for (let { position, block } of to_build) {
              world.set_block({
                position: vec3.add(block_position, position),
                block: block.id,
              });
            }

            return;
          }

          if (block.definition.type === "minecraft:lantern") {
            if (face === "bottom") {
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  hanging: "true",
                }).id,
              });
            } else if (face === "top") {
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  hanging: "false",
                }).id,
              });
            } else {
              let block_above = world.get_block({
                position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
              });
              /// TODO More elaborate check for opacity/model
              if (block_above.name !== "minecraft:air") {
                world.set_block({
                  position: block_position,
                  block: require_block_by_properties(block, {
                    hanging: "true",
                  }).id,
                });
              } else {
                /// Don't plwace it at all!
              }
            }
          } else if (block.definition.type === "minecraft:shulker_box") {
            let state = require_block_by_properties(block, {
              facing: direction_3d,
            });
            world.set_block({
              position: block_position,
              block: state.id,
            });
          } else if (block.definition.type === "minecraft:skull") {
            if (face === "top") {
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  rotation: rotation_based_on_cursor(cursor),
                }).id,
              });
            } else if (face === "bottom") {
              /// Not sure what to do when placed on the bottom of another block
              player.send(
                `* Not sure what to do when a skill is placed on the bottom of another block`
              );
            } else {
              let wall_skull = get_block_by_definition("minecraft:wall_skull", {
                kind: block.definition.kind,
              });
              if (wall_skull == null) {
                player.send(
                  chat`${chat.dark_purple("*")} ${chat.gray("Couldn't find wall skill for")} ${chat.yellow(block.definition.kind)}`
                );
                return;
              }
              // console.log(`wall_skull:`, wall_skull);
              let state = require_block_by_properties(wall_skull, {
                facing: face,
              });
              world.set_block({
                position: block_position,
                block: state.id,
              });
            }
          } else if (block.definition.type === "minecraft:chain") {
            let axis =
              face === "bottom" || face === "top"
                ? "y"
                : face === "east" || face === "west"
                  ? "x"
                  : "z";
            world.set_block({
              position: block_position,
              block: require_block_by_properties(block, {
                axis: axis,
              }).id,
            });
          } else if (block.definition.type === "minecraft:glazed_terracotta") {
            if (face === "bottom" || face === "top") {
              let state = require_block_by_properties(block, {
                facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
              });
              world.set_block({
                position: block_position,
                block: state.id,
              });
            } else {
              let state = require_block_by_properties(block, {
                facing: cardinal_based_on_cursor(cursor),
              });
              world.set_block({
                position: block_position,
                block: state.id,
              });
            }
          } else if (
            block.definition.type === "minecraft:chiseled_book_shelf"
          ) {
            let current_block = world.get_block({ position: position });
            if (
              current_block.block === block &&
              current_block.blockstate.properties!.facing === face
            ) {
              let clicked_slot =
                cursor.y > 0.5
                  ? cursor.x < 1 / 3
                    ? "slot_2_occupied"
                    : cursor.x < 2 / 3
                      ? "slot_1_occupied"
                      : "slot_0_occupied"
                  : cursor.x < 1 / 3
                    ? "slot_5_occupied"
                    : cursor.x < 2 / 3
                      ? "slot_4_occupied"
                      : "slot_3_occupied";

              player.send(`clicked_slot: ${clicked_slot}`);
              let new_block = require_block_by_properties(block, {
                ...current_block.blockstate.properties,
                [clicked_slot]:
                  current_block.blockstate.properties![clicked_slot] === "true"
                    ? "false"
                    : "true",
              });
              world.set_block({
                position: position,
                block: new_block.id,
              });
            } else if (face === "top" || face === "bottom") {
              let new_block = require_block_by_properties(block, {
                facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            } else {
              let new_block = require_block_by_properties(block, {
                facing: face,
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            }
          } else if (block.definition.type === "minecraft:glow_lichen") {
            let current_block = world.get_block({ position: block_position });
            let reversed_direction = reverse_direction_3d(direction_3d);

            if (current_block.block === block) {
              let new_block = require_block_by_properties(block, {
                ...current_block.blockstate.properties,
                [reversed_direction]:
                  current_block.blockstate.properties![reversed_direction] ===
                  "true"
                    ? "false"
                    : "true",
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            } else {
              let new_block = require_block_by_properties(block, {
                [reversed_direction]: "true",
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            }
            // } else if (block.definition.type === "minecraft:double_plant") {
            //   world.set_block({
            //     position: block_position,
            //     block: require_block_by_properties(block, {
            //       half: "lower",
            //     }).id,
            //   });
            //   world.set_block({
            //     position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
            //     block: require_block_by_properties(block, {
            //       half: "upper",
            //     }).id,
            //   });
          } else if (block.definition.type === "minecraft:end_rod") {
            if (face === "bottom" || face === "top") {
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  facing: face,
                }).id,
              });
            } else {
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  facing: face,
                }).id,
              });
            }
          } else if (block.definition.type === "minecraft:candle") {
            let current_block = world.get_block({ position: block_position });
            if (current_block.block === block) {
              let current_candles =
                Number(current_block.blockstate.properties!.candles) - 1;

              let new_candles = (current_candles + 1) % 4;
              let new_block = require_block_by_properties(block, {
                candles: (new_candles + 1).toString(),
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            } else {
              let new_block = require_block_by_properties(block, {
                candles: "1",
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            }
          } else if (block.definition.type === "minecraft:slab") {
            let current_block = world.get_block({ position: block_position });
            if (current_block.block === block) {
              let new_block = require_block_by_properties(block, {
                type: "double",
              });
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            } else {
              let half =
                face === "bottom"
                  ? "top"
                  : face === "top"
                    ? "bottom"
                    : cursor.y > 0.5
                      ? "top"
                      : "bottom";
              world.set_block({
                position: block_position,
                block: require_block_by_properties(block, {
                  type: half,
                }).id,
              });
            }
          } else if (block.definition.type === "minecraft:liquid") {
            let current_block = world.get_block({ position: block_position });
            if (current_block.name === "minecraft:air") {
              /// Place the water/lava
              world.set_block({
                position: block_position,
                block: state,
              });
            } else if (current_block.block === block) {
              /// Change the water/lava level!
              let level = current_block.blockstate.properties!.level;
              /// TODO? Make more robust, eventually
              let new_level = (Number(level) + 1) % 7;
              let new_block = require_block_by_properties(block, {
                level: new_level.toString(),
              });
              player.send(`New liquid level: ${new_block.properties!.level}`);
              world.set_block({
                position: block_position,
                block: new_block.id,
              });
            } else {
              /// Make things waterlogged?
              return;
            }
          } else if (block.definition.type === "minecraft:door") {
            if (face === "top" || face === "bottom") {
              let door_direction = reverse_cardinal(
                cardinal_based_on_cursor(cursor)
              );

              let lower = require_block_by_properties(block, {
                facing: door_direction,
                half: "lower",
              });
              let upper = require_block_by_properties(block, {
                facing: door_direction,
                half: "upper",
              });

              world.set_block({
                position: block_position,
                block: lower.id,
              });
              world.set_block({
                position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
                block: upper.id,
              });
            } else {
              let lower = require_block_by_properties(block, {
                facing: face,
                half: "lower",
              });
              let upper = require_block_by_properties(block, {
                facing: face,
                half: "upper",
              });

              world.set_block({
                position: block_position,
                block: lower.id,
                // transaction_id: sequence,
              });
              world.set_block({
                position: vec3.add(block_position, { x: 0, y: 1, z: 0 }),
                block: upper.id,
                // transaction_id: sequence,
              });
            }
          } else if (block.definition.type === "minecraft:button") {
            if (floor_wall_ceiling === "wall") {
              let state = require_block_by_properties(block, {
                face: floor_wall_ceiling,
                facing: face,
                powered: "false",
              });
              world.set_block({
                position: block_position,
                block: state.id,
              });
            } else {
              let state = require_block_by_properties(block, {
                face: floor_wall_ceiling,
                facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
                powered: "false",
              });
              world.set_block({
                position: block_position,
                block: state.id,
              });
            }
          } else if (block.definition.type === "minecraft:structure") {
            /// Structured block chenanigans!!
            /// ... These can show a line around a region, which I want to (abuse) for worldedit stuff
            /// ... So this is a showcase of that!
            // minecraft_socket.send(
            //   PlayPackets.clientbound.block_update.write({
            //     location: {
            //       x: block_position.x,
            //       y: 0,
            //       z: block_position.z,
            //     },
            //     block: 19356,
            //   })
            // );

            /// I don't have a way to store block entities yet
            // my_chunk_world.set_block({
            //   position: {
            //     ...block_position,
            //     y: -65,
            //   },
            //   block: 19356,
            //   transaction_id: sequence,
            // });

            send_packet(
              PlayPackets.clientbound.block_entity_data.write({
                location: {
                  ...block_position,
                  y: 0,
                },
                type: 20,
                // nbt: structure_block_metadata.nbt,
                nbt: json_to_nbtish({
                  author: "?",
                  ignoreEntities: true,
                  integrity: 1,
                  // metadata: "",
                  mirror: "NONE",
                  mode: "SAVE",
                  name: "Hi",
                  posX: 0,
                  posY: block_position.y + 65,
                  posZ: 0,
                  powered: false,
                  rotation: "NONE",
                  seed: 0n,
                  showboundingbox: true,
                  sizeX: 10,
                  sizeY: 10,
                  sizeZ: 10,
                }),
              })
            );
          } else if (block.definition.type === "minecraft:standing_sign") {
            /// Set some default text on signs, just to show
            /// it is possible!

            let state = default_state;
            if (face === "bottom") {
              return;
            } else if (face === "top") {
              state = require_block_by_properties(block, {
                rotation: rotation_based_on_cursor(cursor),
              });
            } else {
              let wall_sign = get_block_by_definition("minecraft:wall_sign", {
                wood_type: block.definition.wood_type,
              });
              if (wall_sign == null) {
                player.send(
                  chat`${chat.dark_purple("*")} ${chat.gray("Couldn't find wall sign for")} ${chat.yellow(block.definition.wood_type)}`
                );
                return;
              }
              state = require_block_by_properties(wall_sign, {
                facing: face,
              });
            }

            console.log("SIGN!");
            world.set_block({
              position: block_position,
              block: state.id,
            });

            signui.open(block_position, "front").then((text) => {
              world.set_block({
                position: block_position,
                block: state.id,
                block_entity: {
                  type: "minecraft:sign",
                  data: json_to_nbtish({
                    is_waxed: false,
                    front_text: {
                      has_glowing_text: false,
                      color: "black",
                      messages: text.map((x) => JSON.stringify(x)),
                    },
                    back_text: {
                      has_glowing_text: false,
                      color: "black",
                      messages: [
                        JSON.stringify(""),
                        JSON.stringify(""),
                        JSON.stringify(""),
                        JSON.stringify(""),
                      ],
                    },
                  }),
                },
              });
            });
          } else {
            world.set_block({
              position: block_position,
              block: state,
            });
          }
        }
      } else if (event.type === "attack") {
        let {
          target: { position, face },
        } = event;

        let block = world.get_block({ position: position });

        let builders_for_block_type =
          builders_by_block_type[block.block.definition.type];

        if (builders_for_block_type?.destroy) {
          let to_destroy = builders_for_block_type.destroy({
            block: block,
            face: face,
            get_block: (relative_position) =>
              world.get_block({
                position: vec3.add(position, relative_position),
              }),
          });

          console.log(`to_destroy:`, to_destroy);

          for (let { position: relative_position, block } of to_destroy) {
            world.set_block({
              position: vec3.add(position, relative_position),
              block: block.id,
            });
          }

          return;
        } else {
          world.set_block({
            position: position,
            block: 0,
            // transaction_id: sequence,
          });
        }
      }
    },
    { signal }
  );
  return {};
}
