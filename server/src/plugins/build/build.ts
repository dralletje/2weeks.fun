import {
  blocks,
  get_block_by_definition,
  get_block_by_properties,
  require_block_by_properties,
  type BlockDefinition,
  type BlockState,
} from "@2weeks/minecraft-data";
import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { sortBy } from "lodash-es";
import {
  type Slot,
  type CardinalDirection,
  type Face,
} from "../../PluginInfrastructure/MinecraftTypes.ts";
import { type NBT } from "../../protocol/nbt.ts";
import { vec3, type Vec3 } from "../../utils/vec3.ts";
import { eznbt_write } from "../../protocol/eznbt.ts";
import { modulo_cycle } from "../../utils/modulo_cycle.ts";

let Faces = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

let directions3D: { [key in Direction3D]: Vec3 } = {
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};
let HERE: Vec3 = { x: 0, y: 0, z: 0 };

let cardinal_based_on_cursor = (cursor: Vec3): CardinalDirection => {
  let D1 =
    cursor.x + cursor.z > 1 ? ("LEFT_TOP" as const) : ("RIGHT_BOTTOM" as const);
  let D2 =
    cursor.x > cursor.z ? ("LEFT_BOTTOM" as const) : ("RIGHT_TOP" as const);
  let cardinal: CardinalDirection =
    D1 === "LEFT_TOP" && D2 === "LEFT_BOTTOM" ? "east"
    : D1 === "RIGHT_BOTTOM" && D2 === "RIGHT_TOP" ? "west"
    : D1 === "LEFT_TOP" && D2 === "RIGHT_TOP" ? "south"
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

export type HorizontalFace = "north" | "south" | "east" | "west";
let HORIZONTAL_FACES: { [key in HorizontalFace]: Vec3 } = {
  north: Faces.north,
  south: Faces.south,
  east: Faces.east,
  west: Faces.west,
};

let vector_to_face = <const T extends string>(
  needle: Vec3,
  faces: { [key in T]: Vec3 }
): T => {
  let angles = sortBy(Object.entries(faces), ([name, vector]) => {
    return -vec3.dot(needle, vector as Vec3);
  });
  return angles[0][0] as T;
};

type BuildRequest = {
  block: BlockDefinition;
  face: Face;
  cursor: Vec3;
  eyeline: Vec3;
  item: Slot;
  get_block: (relative_position: Vec3) => {
    name: string;
    blockstate: BlockState;
    block: BlockDefinition;
  };
};

type Builder = {
  build?: (change: BuildRequest) => Array<{
    override?: boolean;
    position: Vec3;
    block: BlockState;
    block_entity?: {
      type: RegistryResourceKey<"minecraft:block_entity_type">;
      data: NBT;
    };
  }>;
  destroy?: (change: {
    block: {
      name: string;
      blockstate: BlockState;
      block: BlockDefinition;
    };
    face: Face;
    get_block: (relative_position: Vec3) => {
      name: string;
      blockstate: BlockState;
      block: BlockDefinition;
    };
  }) => Array<{
    position: Vec3;
    block: BlockState;
  }>;
};

let vector_to_rotation = (vector: Vec3): number => {
  /// Rotation only based on x and z
  let angle = Math.atan2(vector.z, vector.x) / Math.PI / 2;
  let rotation = modulo_cycle(Math.round(angle * 16) - 4, 16);
  return rotation;
};

let rotation_based = ({
  cursor,
  eyeline,
}: {
  cursor: Vec3;
  eyeline: Vec3;
}): number => {
  let distance_from_center =
    vec3.length(vec3.difference(cursor, { x: 0.5, y: 1, z: 0.5 })) * 2;

  if (distance_from_center < 0.5) {
    return vector_to_rotation(eyeline);
  } else {
    return rotation_based_on_cursor(cursor);
  }
};

let builder_lower_upper: Builder = {
  build: ({ block, face, cursor, get_block }) => {
    return [
      {
        position: HERE,
        block: require_block_by_properties(block, {
          half: "lower",
        }),
      },
      {
        position: directions3D.up,
        block: require_block_by_properties(block, {
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
};

let builder_horizontal_facing: Builder = {
  build: ({ block, cursor }: BuildRequest) => {
    let state = require_block_by_properties(block, {
      facing: cardinal_based_on_cursor(cursor),
    });
    return [{ position: HERE, block: state }];
  },
};

export let builders_by_block_type: Partial<
  Record<RegistryResourceKey<"minecraft:block_type">, Builder>
> = {
  "minecraft:block": {},
  /// Sugars canes have "age", but that doesn't matter for building
  "minecraft:sugar_cane": {},
  /// Grass has "snowy" but that doesn't matter for building
  "minecraft:grass": {},
  /// Sands and gravels, don't think I need any special build stuff here
  "minecraft:colored_falling": {},

  "minecraft:lectern": builder_horizontal_facing,
  "minecraft:furnace": builder_horizontal_facing,
  "minecraft:beehive": builder_horizontal_facing,

  "minecraft:tall_flower": builder_lower_upper,
  "minecraft:double_plant": builder_lower_upper,

  "minecraft:player_head": {
    build: ({ block, face, cursor, item, eyeline }) => {
      if (face === "top") {
        let state = require_block_by_properties(block, {
          rotation: String(rotation_based({ cursor, eyeline })),
        });
        let profile = item?.properties?.profile;
        return [
          {
            position: HERE,
            block: state,
            block_entity: {
              type: "minecraft:skull",
              data: eznbt_write({
                profile: {
                  properties: profile?.properties,
                },
              }),
            },
          },
        ];
      } else if (face === "bottom") {
        return [];
      } else {
        let wall_skull = get_block_by_definition(
          "minecraft:player_wall_head",
          {}
        );
        if (wall_skull == null) return [];

        let state = require_block_by_properties(wall_skull, {
          facing: cardinal_based_on_cursor(cursor),
        });
        let profile = item?.properties?.profile;
        return [
          {
            position: HERE,
            block: state,
            block_entity: {
              type: "minecraft:skull",
              data: eznbt_write({
                profile: {
                  properties: profile?.properties,
                },
              }),
            },
          },
        ];
      }
    },
  },
  "minecraft:stair": {
    build: ({ block, face, cursor, eyeline, get_block }) => {
      /// Other than minecraft, I'm going to try to soley base the stair orientation
      /// on where you click on the receiving block
      /// (Because it might be cool, and because it is easier for now)
      if (face === "top" || face === "bottom") {
        let distance_from_center =
          vec3.length(vec3.difference(cursor, { x: 0.5, y: 1, z: 0.5 })) * 2;

        if (distance_from_center < 0.5) {
          /// Handle it "like minecraft would"
          let facing = vector_to_face(eyeline, HORIZONTAL_FACES);

          let state = require_block_by_properties(block, {
            facing: facing,
            half: face === "top" ? "bottom" : "top",
          });

          let cardinals = [
            {
              name: "north" as const,
              face: Faces.north,
              block: get_block(Faces.north),
            },
            {
              name: "south" as const,
              face: Faces.south,
              block: get_block(Faces.south),
            },
            {
              name: "east" as const,
              face: Faces.east,
              block: get_block(Faces.east),
            },
            {
              name: "west" as const,
              face: Faces.west,
              block: get_block(Faces.west),
            },
          ];
          let cardinals_with_stairs = cardinals.filter((x) => {
            return get_block(x.face).block.definition === block.definition;
          });

          //// TODOOOOOOOO
          // return [
          //   { position: HERE, block: state },
          //   ...cardinals_with_stairs.map((x) => {
          //     let block = get_block(x.face);
          //     return {
          //       override: true,
          //       position: x.face,
          //       block: require_block_by_properties(block, {
          //         ...block.blockstate.properties,
          //         [reverse_direction_3d(x.name)]: "true",
          //       }),
          //     };
          //   }),
          // ];

          return [{ position: HERE, block: state }];
        } else {
          let state = require_block_by_properties(block, {
            facing: cardinal_based_on_cursor(cursor),
            half: face === "top" ? "bottom" : "top",
          });
          return [{ position: HERE, block: state }];
        }
      } else {
        let state = require_block_by_properties(block, {
          facing: reverse_cardinal(face),
          half: cursor.y > 0.5 ? "top" : "bottom",
        });
        return [{ position: HERE, block: state }];
      }
    },
    // build: ({ block, face, cursor }) => {
    //   /// Other than minecraft, I'm going to try to soley base the stair orientation
    //   /// on where you click on the receiving block
    //   /// (Because it might be cool, and because it is easier for now)
    //   if (face === "top" || face === "bottom") {
    //     // let state = require_block_by_properties(block, {
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
    //     let state = require_block_by_properties(block, {
    //       ...x,
    //       half: face === "top" ? "bottom" : "top",
    //     });
    //     return [{ position: HERE, block: state }];
    //   } else {
    //     let state = require_block_by_properties(block, {
    //       facing: reverse_cardinal(face),
    //       half: cursor.y > 0.5 ? "top" : "bottom",
    //     });
    //     return [{ position: HERE, block: state }];
    //   }
    // },
  },
  "minecraft:trapdoor": {
    build: ({ block, face, cursor }) => {
      if (face === "bottom" || face === "top") {
        let state = require_block_by_properties(block, {
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
        let state = require_block_by_properties(block, {
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
    build: ({ block, face, cursor }) => {
      let axis =
        face === "bottom" || face === "top" ? "y"
        : face === "east" || face === "west" ? "x"
        : "z";
      return [
        {
          position: HERE,
          block: require_block_by_properties(block, {
            axis: axis,
          }),
        },
      ];
    },
  },

  "minecraft:torch": {
    build: ({ block, face, cursor }) => {
      if (face === "bottom") {
        /// Don't place for now
        return [];
      } else if (face === "top") {
        return [
          {
            position: HERE,
            block: block.states.find((x) => x.default)!,
          },
        ];
      } else {
        let wall_skull = get_block_by_definition("minecraft:wall_torch", {
          particle_options: block.definition.particle_options,
        });
        if (wall_skull == null) return [];
        // if (wall_skull == null) {
        //   player.send(
        //     chat`${chat.dark_purple("*")} ${chat.gray("Couldn't find wall torch for")} ${chat.yellow(block.block.particle_options)}`
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

  "minecraft:door": {
    build: ({ block, face, cursor }) => {
      if (face === "top" || face === "bottom") {
        let door_direction = reverse_cardinal(cardinal_based_on_cursor(cursor));

        let hinge =
          door_direction === "east" ?
            cursor.z > 0.5 ?
              "right"
            : "left"
          : door_direction === "west" ?
            cursor.z > 0.5 ?
              "left"
            : "right"
          : door_direction === "north" ?
            cursor.x > 0.5 ?
              "right"
            : "left"
          : cursor.x > 0.5 ? "left"
          : "right";

        let lower = require_block_by_properties(block, {
          facing: door_direction,
          half: "lower",
          hinge: hinge,
        });
        let upper = require_block_by_properties(block, {
          facing: door_direction,
          half: "upper",
          hinge: hinge,
        });

        return [
          { position: HERE, block: lower },
          { position: { x: 0, y: 1, z: 0 }, block: upper },
        ];
      } else {
        let hinge =
          face === "east" ?
            cursor.z > 0.5 ?
              "right"
            : "left"
          : face === "west" ?
            cursor.z > 0.5 ?
              "left"
            : "right"
          : face === "north" ?
            cursor.x > 0.5 ?
              "right"
            : "left"
          : cursor.x > 0.5 ? "left"
          : "right";

        let lower = require_block_by_properties(block, {
          facing: face,
          half: "lower",
          hinge: hinge,
        });
        let upper = require_block_by_properties(block, {
          facing: face,
          half: "upper",
          hinge: hinge,
        });

        return [
          { position: HERE, block: lower },
          { position: { x: 0, y: 1, z: 0 }, block: upper },
        ];
      }
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

  "minecraft:button": {
    build: ({ block, face, cursor }) => {
      let floor_wall_ceiling =
        face === "top" ? "floor"
        : face === "bottom" ? "ceiling"
        : "wall";

      if (floor_wall_ceiling === "wall") {
        let state = require_block_by_properties(block, {
          face: floor_wall_ceiling,
          facing: face,
          powered: "false",
        });
        return [
          {
            position: HERE,
            block: state,
          },
        ];
      } else {
        let state = require_block_by_properties(block, {
          face: floor_wall_ceiling,
          facing: reverse_cardinal(cardinal_based_on_cursor(cursor)),
          powered: "false",
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

  "minecraft:fence": {
    build: ({ block, face, cursor, get_block }) => {
      let cardinals = [
        { name: "north" as const, face: Faces.north },
        { name: "south" as const, face: Faces.south },
        { name: "east" as const, face: Faces.east },
        { name: "west" as const, face: Faces.west },
      ];

      let carindals_with_same_fence = cardinals.filter((x) => {
        return get_block(x.face).block === block;
      });

      if (face === "top") {
        let distance_from_center =
          vec3.length(vec3.difference(cursor, { x: 0.5, y: 1, z: 0.5 })) * 2;

        if (distance_from_center < 0.1) {
          return [
            {
              position: HERE,
              block: require_block_by_properties(block, {}),
            },
          ];
        } else if (distance_from_center < 0.75) {
          /// Calculate based on surrounding blocks
          return [
            {
              position: HERE,
              block: require_block_by_properties(block, {
                north:
                  carindals_with_same_fence.some((x) => x.name === "north") ?
                    "true"
                  : "false",
                south:
                  carindals_with_same_fence.some((x) => x.name === "south") ?
                    "true"
                  : "false",
                east:
                  carindals_with_same_fence.some((x) => x.name === "east") ?
                    "true"
                  : "false",
                west:
                  carindals_with_same_fence.some((x) => x.name === "west") ?
                    "true"
                  : "false",
              }),
            },
            ...carindals_with_same_fence.map((x) => {
              return {
                override: true,
                position: x.face,
                block: require_block_by_properties(block, {
                  ...get_block(x.face).blockstate.properties,
                  [reverse_direction_3d(x.name)]: "true",
                }),
              };
            }),
          ];
        } else {
          /// Force direction
          let cardinal = cardinal_based_on_cursor(cursor);
          let state = require_block_by_properties(block, {
            [cardinal]: "true",
          });

          let block_on_this_face = get_block(Faces[cardinal]);

          if (block_on_this_face.block === block) {
            return [
              { position: HERE, block: state },
              {
                override: true,
                position: Faces[cardinal],
                block: require_block_by_properties(block, {
                  ...block_on_this_face.blockstate.properties,
                  [reverse_direction_3d(cardinal)]: "true",
                }),
              },
            ];
          } else {
            return [{ position: HERE, block: state }];
          }
        }
      } else if (face === "bottom") {
        /// TODO Not yet sure
        return [];
      } else {
        let cardinal = cardinal_based_on_cursor(cursor);
        let state = require_block_by_properties(block, {
          [reverse_cardinal(cardinal)]: "true",
        });

        let block_on_this_face = get_block(Faces[reverse_cardinal(cardinal)]);

        if (block_on_this_face.block === block) {
          return [
            { position: HERE, block: state },
            {
              override: true,
              position: Faces[reverse_cardinal(cardinal)],
              block: require_block_by_properties(block, {
                ...block_on_this_face.blockstate.properties,
                [cardinal]: "true",
              }),
            },
          ];
        } else {
          return [{ position: HERE, block: state }];
        }
      }
    },
    destroy: ({ block, face, get_block }) => {
      let cardinals = [
        { name: "north" as const, face: Faces.north },
        { name: "south" as const, face: Faces.south },
        { name: "east" as const, face: Faces.east },
        { name: "west" as const, face: Faces.west },
      ];

      let carindals_with_same_fence = cardinals.filter((x) => {
        return get_block(x.face).block === block.block;
      });

      let x = require_block_by_properties(block.block, {
        north:
          carindals_with_same_fence.some((x) => x.name === "north") ? "true" : (
            "false"
          ),
        south:
          carindals_with_same_fence.some((x) => x.name === "south") ? "true" : (
            "false"
          ),
        east:
          carindals_with_same_fence.some((x) => x.name === "east") ? "true" : (
            "false"
          ),
        west:
          carindals_with_same_fence.some((x) => x.name === "west") ? "true" : (
            "false"
          ),
      });

      let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;

      return [
        { position: HERE, block: AIR },
        ...carindals_with_same_fence.map((x) => {
          let block = get_block(x.face);
          return {
            position: x.face,
            block: require_block_by_properties(block.block, {
              ...block.blockstate.properties,
              [reverse_direction_3d(x.name)]: "false",
            }),
          };
        }),
      ];
    },
  },

  "minecraft:bed": {
    build: ({ block, face, cursor }) => {
      if (face === "top") {
        let direction = cardinal_based_on_cursor(cursor);
        let head = require_block_by_properties(block, {
          facing: reverse_cardinal(direction),
          part: "head",
        });
        let foot = require_block_by_properties(block, {
          facing: reverse_cardinal(direction),
          part: "foot",
        });

        let direction_as_vector = Faces[direction];

        return [
          { position: HERE, block: foot },
          {
            position: direction_as_vector,
            block: head,
          },
        ];
      } else {
        return [];
      }
    },
    destroy: ({ block, face, get_block }) => {
      let AIR = get_block_by_properties(blocks["minecraft:air"], {})!;

      let { part, facing } = block.blockstate.properties! as {
        part: "head" | "foot";
        facing: CardinalDirection;
      };

      let other_block_position =
        part === "head" ? Faces[facing] : Faces[reverse_cardinal(facing)];

      let other_block = get_block(other_block_position);
      /// TODO CHECK IF OTHER BLOCK IS ACTUALLY THE OTHER PART OF THE BED

      return [
        { position: HERE, block: AIR },
        { position: other_block_position, block: AIR },
      ];
    },
  },

  /// TODO Fix
  "minecraft:candle": {
    build: ({ block, face, cursor, get_block }) => {
      console.log(`face:`, face);
      let clicked_on = vec3.multiply(Faces[face], -1);
      let current_block = get_block(clicked_on);

      console.log(`clicked_on:`, clicked_on);
      console.log(`current_block:`, current_block);

      if (block === current_block.block) {
        let current_candles =
          Number(current_block.blockstate.properties!.candles) - 1;

        let new_candles = (current_candles + 1) % 4;
        let new_block = require_block_by_properties(block, {
          candles: (new_candles + 1).toString(),
        });
        return [{ position: clicked_on, block: new_block }];
      } else {
        let new_block = require_block_by_properties(block, {
          candles: "1",
        });
        return [{ position: HERE, block: new_block }];
      }
    },
  },

  "minecraft:lantern": {
    build: ({ block, face, cursor, get_block }) => {
      if (face === "bottom") {
        return [
          {
            position: HERE,
            block: require_block_by_properties(block, {
              hanging: "true",
            }),
          },
        ];
      } else if (face === "top") {
        return [
          {
            position: HERE,
            block: require_block_by_properties(block, {
              hanging: "false",
            }),
          },
        ];
      } else {
        let block_above = get_block({ x: 0, y: 1, z: 0 });
        /// TODO More elaborate check for opacity/model
        if (block_above.name !== "minecraft:air") {
          return [
            {
              position: HERE,
              block: require_block_by_properties(block, {
                hanging: "true",
              }),
            },
          ];
        } else {
          /// Don't plwace it at all!
          return [];
        }
      }
    },
  },

  "minecraft:slab": {
    build: ({ block, face, cursor, get_block }) => {
      let clicked_on = vec3.multiply(Faces[face], -1);
      let current_block = get_block(clicked_on);

      if (current_block.block === block) {
        let new_block = require_block_by_properties(block, {
          type: "double",
        });
        return [{ position: clicked_on, block: new_block }];
      } else {
        let half =
          face === "bottom" ? "top"
          : face === "top" ? "bottom"
          : cursor.y > 0.5 ? "top"
          : "bottom";
        return [
          {
            position: HERE,
            block: require_block_by_properties(block, {
              type: half,
            }),
          },
        ];
      }
    },
  },
};
