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
import { PlayPackets } from "../protocol/minecraft-protocol.ts";

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

export default function signs_build_plugin({
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
      if (event.type === "attack") {
        /// Default plugin handles removal of blocks
      }

      let {
        target: { position, type, face, cursor },
        item,
      } = event;

      let face_vector = Faces[face];

      let slot = player.inventory.item_holding;

      let floor_wall_ceiling =
        face === "top" ? "floor" : face === "bottom" ? "ceiling" : "wall";

      if (slot) {
        console.log(`slot.item:`, slot.item);

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

        if (block.definition.type === "minecraft:standing_sign") {
          /// Set some default text on signs, just to show
          /// it is possible!
          console.log("SIGN!");
          world.set_block({
            position: block_position,
            block: state,
          });

          signui.open(block_position, "front").then((text) => {
            world.set_block({
              position: block_position,
              block: state,
              block_entity: {
                type: "minecraft:sign",
                data: json_to_nbtish({
                  back_text: {
                    has_glowing_text: false,
                    color: "black",
                    messages: text.map((x) => JSON.stringify(x)),
                  },
                  is_waxed: false,
                  front_text: {
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
    },
    { signal }
  );
  return {};
}
