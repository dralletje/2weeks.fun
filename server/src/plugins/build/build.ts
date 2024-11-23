import {
  type BlockDefinition,
  type BlockState,
  blocks,
  get_block_by_definition,
  get_block_by_properties,
  require_block_by_properties,
} from "@2weeks/minecraft-data";
import { type Vec3 } from "../../utils/vec3.ts";
import {
  type Face,
  type CardinalDirection,
} from "../../PluginInfrastructure/MinecraftTypes.ts";
import { chat } from "../../utils/chat.ts";

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

let angle_based_on_cursor = (cursor: Vec3): number => {
  let unit_circle_x = cursor.x * 2 - 1;
  let unit_circle_z = cursor.z * 2 - 1;

  return Math.atan2(unit_circle_z, unit_circle_x) / (2 * Math.PI) + 0.5;
};

let rotation_based_on_cursor = (cursor: Vec3): number => {
  let angle = angle_based_on_cursor(cursor);
  let rotation = (Math.round(angle * 16) + 12) % 16;

  return rotation;
};

let rotation_based_on_cursor8 = (cursor: Vec3): number => {
  let angle = angle_based_on_cursor(cursor);
  let rotation = (Math.round(angle * 16) + 14) % 16;

  return rotation;
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

type Builder = {
  build?: (change: {
    definition: BlockDefinition;
    current_blockstate: BlockState;
    position_clicked: Vec3;
    face: Face;
    cursor: Vec3;
    get_block: (relative_position: Vec3) => any;
  }) => Array<{
    position: Vec3;
    block: BlockState;
  }>;
  destroy?: (change: {
    block: {
      name: string;
      blockstate: BlockState;
      block: BlockDefinition;
    };
    face: Face;
    get_block: (relative_position: Vec3) => any;
  }) => Array<{
    position: Vec3;
    block: BlockState;
  }>;
};

export let builders_by_block_type: { [key: string]: Builder } = {
  "minecraft:tall_flower": {
    build: ({
      definition,
      current_blockstate,
      position_clicked,
      face,
      cursor,
      get_block,
    }) => {
      let above = get_block(directions3D.up);

      return [
        {
          position: HERE,
          block: require_block_by_properties(definition, {
            half: "lower",
          }),
        },
        {
          position: directions3D.up,
          block: require_block_by_properties(definition, {
            half: "upper",
          }),
        },
      ];
    },
    destroy: ({ block, face, get_block }) => {
      let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;
      if (block.blockstate.properties!.half === "upper") {
        let below = get_block(directions3D.down);
        if (
          below.name === block.name &&
          below.blockstate.properties!.half === "lower"
        ) {
          return [
            { position: HERE, block: AIR },
            { position: directions3D.down, block: AIR },
          ];
        } else {
          return [{ position: HERE, block: AIR }];
        }
      } else {
        let above = get_block(directions3D.up);
        if (
          above.name === block.name &&
          above.blockstate.properties!.half === "upper"
        ) {
          return [
            { position: HERE, block: AIR },
            { position: directions3D.up, block: AIR },
          ];
        } else {
          return [{ position: HERE, block: AIR }];
        }
      }
    },
  },
  "minecraft:double_plant": {
    build: ({
      definition,
      current_blockstate,
      position_clicked,
      face,
      cursor,
      get_block,
    }) => {
      let above = get_block(directions3D.up);

      return [
        {
          position: HERE,
          block: require_block_by_properties(definition, {
            half: "lower",
          }),
        },
        {
          position: directions3D.up,
          block: require_block_by_properties(definition, {
            half: "upper",
          }),
        },
      ];
    },
    destroy: ({ block, face, get_block }) => {
      let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;
      if (block.blockstate.properties!.half === "upper") {
        let below = get_block(directions3D.down);
        if (
          below.name === block.name &&
          below.blockstate.properties!.half === "lower"
        ) {
          return [
            { position: HERE, block: AIR },
            { position: directions3D.down, block: AIR },
          ];
        } else {
          return [{ position: HERE, block: AIR }];
        }
      } else {
        let above = get_block(directions3D.up);
        if (
          above.name === block.name &&
          above.blockstate.properties!.half === "upper"
        ) {
          return [
            { position: HERE, block: AIR },
            { position: directions3D.up, block: AIR },
          ];
        } else {
          return [{ position: HERE, block: AIR }];
        }
      }
    },
  },
  "minecraft:stair": {
    build: ({ definition, face, cursor }) => {
      /// Other than minecraft, I'm going to try to soley base the stair orientation
      /// on where you click on the receiving block
      /// (Because it might be cool, and because it is easier for now)
      if (face === "top" || face === "bottom") {
        let state = require_block_by_properties(definition, {
          facing: cardinal_based_on_cursor(cursor),
          half: face === "top" ? "bottom" : "top",
        });
        return [{ position: HERE, block: state }];
      } else {
        let state = require_block_by_properties(definition, {
          facing: reverse_cardinal(face),
          half: cursor.y > 0.5 ? "top" : "bottom",
        });
        return [{ position: HERE, block: state }];
      }
    },
    // build: ({ definition, face, cursor }) => {
    //   /// Other than minecraft, I'm going to try to soley base the stair orientation
    //   /// on where you click on the receiving block
    //   /// (Because it might be cool, and because it is easier for now)
    //   if (face === "top" || face === "bottom") {
    //     // let state = require_block_by_properties(definition, {
    //     //   facing: cardinal_based_on_cursor(cursor),
    //     //   half: face === "top" ? "bottom" : "top",
    //     // });
    //     // return [{ position: HERE, block: state }];
    //     let x = [
    //       { facing: "north", shape: "inner_left" },
    //       { facing: "north" },
    //       { facing: "east", shape: "inner_left" },
    //       { facing: "east" },
    //       { facing: "south", shape: "inner_left" },
    //       { facing: "south" },
    //       { facing: "west", shape: "inner_left" },
    //       { facing: "west" },
    //     ][Math.round(rotation_based_on_cursor8(cursor) / 2)] as any;
    //     let state = require_block_by_properties(definition, {
    //       ...x,
    //       half: face === "top" ? "bottom" : "top",
    //     });
    //     return [{ position: HERE, block: state }];
    //   } else {
    //     let state = require_block_by_properties(definition, {
    //       facing: reverse_cardinal(face),
    //       half: cursor.y > 0.5 ? "top" : "bottom",
    //     });
    //     return [{ position: HERE, block: state }];
    //   }
    // },
  },
  "minecraft:trapdoor": {
    build: ({ definition, face, cursor }) => {
      if (face === "bottom" || face === "top") {
        let state = require_block_by_properties(definition, {
          half: face === "bottom" ? "top" : "bottom",
          facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
          open: "false",
        });
        return [
          {
            position: HERE,
            block: state,
          },
        ];
      } else {
        let state = require_block_by_properties(definition, {
          half: cursor.y > 0.5 ? "top" : "bottom",
          facing: cardinal_based_on_cursor(cursor),
          open: 0.25 < cursor.y && cursor.y < 0.75 ? "true" : "false",
        });
        return [
          {
            position: HERE,
            block: state,
          },
        ];
      }
    },
  },
  "minecraft:rotated_pillar": {
    build: ({ definition, face, cursor }) => {
      let axis =
        face === "bottom" || face === "top"
          ? "y"
          : face === "east" || face === "west"
            ? "x"
            : "z";
      return [
        {
          position: HERE,
          block: require_block_by_properties(definition, {
            axis: axis,
          }),
        },
      ];
    },
  },

  "minecraft:torch": {
    build: ({ definition, face, cursor }) => {
      if (face === "bottom") {
        /// Don't place for now
        return [];
      } else if (face === "top") {
        return [
          {
            position: HERE,
            block: definition.states.find((x) => x.default)!,
          },
        ];
      } else {
        let wall_skull = get_block_by_definition("minecraft:wall_torch", {
          particle_options: definition.definition.particle_options,
        });
        if (wall_skull == null) return [];
        // if (wall_skull == null) {
        //   player.send(
        //     chat`${chat.dark_purple("*")} ${chat.gray("Couldn't find wall torch for")} ${chat.yellow(block.definition.particle_options)}`
        //   );
        //   return;
        // }
        return [
          {
            position: HERE,
            block: require_block_by_properties(wall_skull, {
              facing: face,
            }),
          },
        ];
      }
    },
  },
};
