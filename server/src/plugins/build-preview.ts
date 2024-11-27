import { Signal } from "signal-polyfill";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  entity_uuid_counter,
  type Entity,
} from "../Drivers/entities_driver.ts";
import { type AnySignal, effect } from "../utils/signals.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";
import { isEmpty, isEqual, sortBy } from "lodash-es";
import {
  blocks,
  get_block_by_properties,
  type BlockState,
} from "@2weeks/minecraft-data";
import { builders_by_block_type, type HorizontalFace } from "./build/build.ts";
import { chat } from "../utils/chat.ts";
import { emplace } from "../packages/immappable.ts";
import { get_block_in_sight } from "../utils/raytrace.ts";
import { slot_to_packetable } from "../PluginInfrastructure/BasicPlayer.ts";

let pitch_yaw_to_vector = ({ pitch, yaw }: { pitch: number; yaw: number }) => {
  return {
    x: Math.sin(pitch + 0.5 * Math.PI) * Math.cos(yaw + 0.5 * Math.PI),
    z: Math.sin(pitch + 0.5 * Math.PI) * Math.sin(yaw + 0.5 * Math.PI),
    y: Math.cos(pitch + 0.5 * Math.PI),
  };
};

let Faces = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
} as const;

let debounce_signal = <T>(signal: AnySignal<T>, time: number) => {
  let last_value = signal.get();
  let last_time = Date.now();

  return new Signal.Computed(() => {
    let value = signal.get();
    let now = Date.now();

    if (value !== last_value) {
      last_value = value;
      last_time = now;
    }

    if (now - last_time < time) {
      return last_value;
    }

    return value;
  });
};

let PLAYER_EYE_POSITION = {
  x: 0,
  y: 1.62,
  z: 0,
};

let facing_to_rotation = (facing: HorizontalFace) => {
  switch (facing) {
    case "north":
      return 0 * Math.PI;
    case "south":
      return 1 * Math.PI;
    case "west":
      return 0.5 * Math.PI;
    case "east":
      return 1.5 * Math.PI;
  }
};

export default function build_preview_plugin({
  player,
  world,
}: Plugin_v1_Args): Plugin_v1 {
  let sight$ = new Signal.Computed(() => {
    let looking_vector = pitch_yaw_to_vector({
      pitch: player.position.pitch,
      yaw: player.position.yaw,
    });

    let eye_position = vec3.add(player.position, PLAYER_EYE_POSITION);

    return get_block_in_sight({
      world: world,
      origin: eye_position,
      direction: looking_vector,
      max_distance: 4.5,
    });
  });

  let block_in_sight$ = new Signal.Computed(
    () => {
      let sight = sight$.get();
      if (sight == null) {
        return null;
      }
      return world.get_block({ position: sight.block });
    },
    { equals: isEqual }
  );

  effect(() => {
    let block = block_in_sight$.get();
    if (block == null) {
      return;
    }

    let properties =
      isEmpty(block.blockstate.properties) ? "" : (
        chat`${chat.gray("[")}${Object.entries(block.blockstate.properties).map(
          ([key, value], index, array) =>
            chat`${chat.red(key)}${chat.gray("=")}${chat.dark_purple(value)}${index === array.length - 1 ? "" : chat.gray(", ")}`
        )}${chat.gray("]")}`
      );

    player.statusbar(chat`${chat.white(block.name)}${properties}`);
  });

  // let sight_debounced$ = debounce_signal(sight$, 100);

  let blocks_to_build$ = new Signal.Computed<{
    position: Vec3;
    changes: Array<{ relative_position: Vec3; block: BlockState }>;
  } | null>(() => {
    let item_in_hand = player.inventory.item_holding;
    if (item_in_hand == null) {
      return null;
    }

    let sight = sight$.get();
    if (sight == null) {
      return null;
    }

    let block = blocks[item_in_hand.item];
    if (block == null) {
      return null;
    }

    if (item_in_hand.properties?.custom_data?.block_properties) {
      let { block: block_found, face_hit } = sight;

      let facedirection = Faces[face_hit] ?? { x: 0, y: 0, z: 0 };
      let blocktoshow = vec3.add(block_found, facedirection);
      let block_with_properties = get_block_by_properties(
        block,
        item_in_hand.properties.custom_data.block_properties
      );

      if (block_with_properties == null) {
        return null;
      }

      return {
        position: blocktoshow,
        changes: [
          {
            relative_position: { x: 0, y: 0, z: 0 },
            block: block_with_properties,
          },
        ],
      };
    }

    let { block: block_found, face_hit, face_hit_point } = sight;

    let facedirection = Faces[face_hit] ?? { x: 0, y: 0, z: 0 };
    let blocktoshow = vec3.add(block_found, facedirection);

    let builder = builders_by_block_type[block.definition.type];

    let looking_vector = pitch_yaw_to_vector({
      pitch: player.position.pitch,
      yaw: player.position.yaw,
    });

    if (builder?.build != null) {
      let changes = builder.build({
        cursor: vec3.difference(block_found, face_hit_point),
        block: block,
        item: item_in_hand,
        face: face_hit,
        eyeline: looking_vector,
        get_block: (position) =>
          world.get_block({ position: vec3.add(blocktoshow, position) }),
      });

      if (changes.length === 0) {
        return { position: blocktoshow, changes: [] };
      } else {
        let center = vec3.difference(blocktoshow, changes[0].position);

        let can_build = changes.every((change) => {
          let position = vec3.add(blocktoshow, change.position);
          let block = world.get_block({ position });
          return (
            change.override ||
            block == null ||
            block.block.definition.type === "minecraft:air"
          );
          // return world.can_build({ position, block: change.block });
        });

        if (!can_build) {
          return null;
        }

        return {
          position: blocktoshow,
          changes: changes.map((change) => {
            return {
              relative_position: change.position,
              block: change.block,
            };
          }),
        };
      }
    } else {
      return {
        position: blocktoshow,
        changes: [
          {
            relative_position: { x: 0, y: 0, z: 0 },
            block: block.states.find((x) => x.default)!,
          },
        ],
      };
    }
  });

  let my_uuids = new Map<number, bigint>();

  let head_uuid = entity_uuid_counter.get_id();
  let head_entities$ = new Signal.Computed((): Map<bigint, Entity> | null => {
    let changes = blocks_to_build$.get();
    if (changes?.changes.length !== 1) {
      return null;
    }

    let item_in_hand = player.inventory.item_holding;
    if (item_in_hand == null || item_in_hand.item !== "minecraft:player_head") {
      return null;
    }

    /// We got a player head! Show this with an item display instead of a block display

    let profile = item_in_hand.properties?.profile;
    let change = changes.changes[0];
    let position = vec3.add(changes.position, change.relative_position);

    let rotation = Number(change.block.properties?.rotation ?? "0");

    /// If facing is not null, it means it is a wall head (bit hacky)
    let facing = change.block.properties?.facing;

    let center = vec3.add(position, { x: 0.5, y: 0.75, z: 0.5 });

    let distance_player_preview = vec3.length(
      vec3.difference(vec3.add(player.position, { x: 0, y: 1.6, z: 0 }), center)
    );

    /// If player is 0.8 blocks away from the center of the block, don't show the preview (0 size)
    /// From 0.8 to 1.3 blocks away, show a preview increasing from 0.4 to 1
    /// From 1.3 onward show a preview of 1
    let preview_size =
      distance_player_preview < 0.8 ? 0
      : distance_player_preview < 1.3 ?
        0.4 + (distance_player_preview - 0.8) * 0.6
      : 1;

    return new Map([
      [
        head_uuid,
        {
          type: "minecraft:item_display",
          position: vec3.add(center, {
            x: 0,
            y: -(1 - preview_size) / 4,
            z: 0,
          }),
          yaw:
            facing ?
              (facing_to_rotation(facing as any) / 360) * 256
            : (rotation / 16) * Math.PI * 2,
          // head_yaw: 30,
          metadata_raw: new Map([
            [
              23,
              {
                type: "slot",
                value: slot_to_packetable({
                  count: 1,
                  item: "minecraft:player_head",
                  properties: {
                    // item_name: chat.red`${heads.profile.name}`,
                    profile: profile,
                  },
                }),
              },
            ],
            // [15, { type: "byte", value: 3 }],
            // [8, { type: "varint", value: 1 }],
            // [9, { type: "varint", value: 10 }],
            [10, { type: "varint", value: 1 }],

            // [
            //   11,
            //   {
            //     type: "vector3",
            //     value: vec3.multiply(
            //       { x: -0.5, y: -0.5, z: -0.5 },
            //       preview_size
            //     ),
            //   },
            // ],
            [
              12,
              {
                type: "vector3",
                value: { x: preview_size, y: preview_size, z: preview_size },
              },
            ],

            /// Shadow
            [18, { type: "float", value: 0.2 }],
            [19, { type: "float", value: 1 }],
          ]),
        } as Entity,
      ],
    ]);
  });

  let block_entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    let changes = blocks_to_build$.get();

    if (changes == null) {
      return new Map();
    }

    let center = vec3.add(changes.position, {
      x: 0.5,
      y: 0.5,
      z: 0.5,
    });

    let distance_player_preview = vec3.length(
      vec3.difference(vec3.add(player.position, { x: 0, y: 1.6, z: 0 }), center)
    );
    /// If player is 0.8 blocks away from the center of the block, don't show the preview (0 size)
    /// From 0.8 to 1.3 blocks away, show a preview increasing from 0.2 to 0.5
    /// From 1.3 onward show a preview of 0.5
    let preview_size =
      distance_player_preview < 0.8 ? 0
      : distance_player_preview < 1.3 ?
        0.2 + (distance_player_preview - 0.8) * 0.3
      : 0.5;

    return new Map(
      changes.changes.map((change, index) => {
        let uuid = emplace(my_uuids, index, {
          insert: () => entity_uuid_counter.get_id(),
        });

        let displacement = vec3.multiply(
          change.relative_position,
          preview_size
        );

        return [
          uuid,
          {
            type: "minecraft:block_display",
            position: vec3.add(center, displacement),
            metadata_raw: new Map([
              [23, { type: "block_state", value: change.block.id }],

              // [8, { type: "varint", value: 1 }],
              // [9, { type: "varint", value: 1 }],
              [10, { type: "varint", value: 1 }],
              [
                11,
                {
                  type: "vector3",
                  value: vec3.multiply(
                    { x: -0.5, y: -0.5, z: -0.5 },
                    preview_size
                  ),
                },
              ],
              [
                12,
                {
                  type: "vector3",
                  value: {
                    x: preview_size,
                    y: preview_size,
                    z: preview_size,
                  },
                },
              ],

              [18, { type: "float", value: 0.2 }],
              [19, { type: "float", value: 1 }],
            ]),
          } as Entity,
        ] as const;
      })
    );
  });

  return {
    sinks: {
      entities$: new Signal.Computed(() => {
        let head_entities = head_entities$.get();
        if (head_entities != null) {
          return head_entities;
        } else {
          return block_entities$.get();
        }
      }),
    },
  };
}
// ...(other_block
//   ? [
//       [
//         preview2_uuid,
//         {
//           type: "minecraft:block_display",
//           position: vec3.add(
//             vec3.add(blocktoshow, other_block.position),
//             {
//               x: 0.5,
//               y: -0.25,
//               z: 0.5,
//             }
//           ),
//           metadata_raw: new Map([
//             [
//               23,
//               { type: "block_state", value: other_block.block.id },
//             ],

//             // [8, { type: "varint", value: 1 }],
//             // [9, { type: "varint", value: 6 }],
//             // [10, { type: "varint", value: 6 }],
//             [
//               11,
//               {
//                 type: "vector3",
//                 value: { x: -0.25, y: 0, z: -0.25 },
//               },
//             ],
//             [
//               12,
//               {
//                 type: "vector3",
//                 value: { x: 0.5, y: 0.5, z: 0.5 },
//               },
//             ],

//             [18, { type: "float", value: 0.2 }],
//             [19, { type: "float", value: 1 }],
//           ]),
//         } as Entity,
//       ] as const,
//     ]
//   : []),

// [
//   point_uuid,
//   {
//     type: "minecraft:item_display",
//     x: most_possible.pos.x,
//     y: most_possible.pos.y,
//     z: most_possible.pos.z,
//     pitch: 0,
//     yaw: 0,
//     head_yaw: 0,
//     data: 0,
//     velocity_x: 0,
//     velocity_y: 0,
//     velocity_z: 0,

//     metadata_raw: new Map([
//       [
//         23,
//         {
//           type: "slot",
//           value: slot_to_packetable({
//             count: 2,
//             item: "minecraft:snowball",
//           }),
//         },
//       ],

//       [15, { type: "byte", value: 3 }],
//       [8, { type: "varint", value: 1 }],
//       [9, { type: "varint", value: 10 }],
//       [10, { type: "varint", value: 10 }],
//     ]),
//   } satisfies Entity,
// ],
// [
//   pointer_uuid,
//   {
//     type: "minecraft:item_display",
//     x: position.x + 1.8,
//     y: position.y + 1.8,
//     z: position.z + 1.8,
//     pitch: ((position.pitch + 90) / 360) * 256,
//     yaw: (position.yaw / 360) * 256,
//     head_yaw: 0,
//     data: 0,
//     velocity_x: 10000,
//     velocity_y: 0,
//     velocity_z: 0,
//     metadata_raw: new Map([
//       [
//         23,
//         {
//           type: "slot",
//           value: slot_to_packetable({
//             count: 2,
//             item: "minecraft:end_rod",
//           }),
//         },
//       ],

//       [8, { type: "varint", value: 1 }],
//       [9, { type: "varint", value: 10 }],
//       [10, { type: "varint", value: 10 }],

//       // [23, { type: "block_state", value: 1 }],
//       // [12, { type: "vector3", value: { x: 10, y: 10, z: 10 } }],
//     ]),
//   } satisfies Entity,
// ],
