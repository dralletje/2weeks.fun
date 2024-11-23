import { Signal } from "signal-polyfill";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { entity_uuid_counter } from "../Unique.ts";
import { type Entity } from "../Drivers/entities_driver.ts";
import { effect } from "../signals.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";
import { isEmpty, isEqual, sortBy } from "lodash-es";
import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";
import { blocks, type BlockState } from "@2weeks/minecraft-data";
import { builders_by_block_type } from "./build/build.ts";
import { chat } from "../utils/chat.ts";

let pitch_yaw_to_vector = (rotation: { pitch: number; yaw: number }) => {
  let pitch = ((rotation.pitch + 90) / 360) * Math.PI * 2;
  let yaw = ((rotation.yaw + 90) / 360) * Math.PI * 2;

  return {
    x: Math.sin(pitch) * Math.cos(yaw),
    z: Math.sin(pitch) * Math.sin(yaw),
    y: Math.cos(pitch),
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

/// This can be improved...
let raytrace = function* (from: Vec3, direction: Vec3, max_distance: number) {
  let distance = vec3.length(direction);
  let normalized_direction = vec3.normalize(direction);

  let step = 0.1;

  for (let i = 0; i < max_distance; i += step) {
    let point = vec3.add(from, vec3.multiply(normalized_direction, i));
    yield point;
  }
};

export default function build_preview_plugin({
  player,
  world,
}: Plugin_v1_Args): Plugin_v1 {
  let pointer_uuid = entity_uuid_counter.get_id();
  let point_uuid = entity_uuid_counter.get_id();
  let preview_uuid = entity_uuid_counter.get_id();
  let preview2_uuid = entity_uuid_counter.get_id();

  let item_in_hand$ = new Signal.Computed(() => {
    let item_in_hard = player.hotbar$.get()[player.selected_hotbar_slot$.get()];
    return item_in_hard;
  });

  let sight$ = new Signal.Computed(() => {
    let position = player.position;

    let looking_vector = pitch_yaw_to_vector({
      pitch: position.pitch,
      yaw: position.yaw,
    });

    let eye_position = {
      x: position.x,
      y: position.y + 1.6,
      z: position.z,
    };

    let last_block = vec3.floor(eye_position);
    let block_found: Position | null = null;
    let point_found: Vec3 | null = null;
    for (let point of raytrace(eye_position, looking_vector, 4.5)) {
      let block = vec3.floor(point);
      if (isEqual(block, last_block)) continue;
      last_block = block;

      let x = world.get_block({ position: block });
      if (
        x.block.definition.type !== "minecraft:air" &&
        x.block.definition.type !== "minecraft:liquid"
      ) {
        point_found = point;
        block_found = block;
        break;
      }
    }

    if (block_found == null || point_found == null) {
      return null;
    }

    let x1 = (block_found.x - point_found.x) / looking_vector.x;
    let x2 = (block_found.x + 1 - point_found.x) / looking_vector.x;

    let x21 = vec3.add(point_found, vec3.multiply(looking_vector, x1));
    let x22 = vec3.add(point_found, vec3.multiply(looking_vector, x2));

    let y1 = (block_found.y - point_found.y) / looking_vector.y;
    let y2 = (block_found.y + 1 - point_found.y) / looking_vector.y;

    let y21 = vec3.add(point_found, vec3.multiply(looking_vector, y1));
    let y22 = vec3.add(point_found, vec3.multiply(looking_vector, y2));

    let z1 = (block_found.z - point_found.z) / looking_vector.z;
    let z2 = (block_found.z + 1 - point_found.z) / looking_vector.z;

    let z21 = vec3.add(point_found, vec3.multiply(looking_vector, z1));
    let z22 = vec3.add(point_found, vec3.multiply(looking_vector, z2));

    let X_MIN_1 = { x: -1, y: 0, z: 0 };
    let Y_MIN_1 = { x: 0, y: -1, z: 0 };
    let Z_MIN_1 = { x: 0, y: 0, z: -1 };

    let possible_faces = [
      {
        face: "west",
        pos: x21,
        block: vec3.floor(x21),
      },
      {
        face: "east",
        pos: x22,
        block: vec3.add(vec3.floor(x22), X_MIN_1),
      },
      {
        face: "bottom",
        pos: y21,
        block: vec3.floor(y21),
      },
      {
        face: "top",
        pos: y22,
        block: vec3.add(vec3.floor(y22), Y_MIN_1),
      },
      {
        face: "north",
        pos: z21,
        block: vec3.floor(z21),
      },
      {
        face: "south",
        pos: z22,
        block: vec3.add(vec3.floor(z22), Z_MIN_1),
      },
    ];

    let still_possible = possible_faces.filter(({ block }) =>
      isEqual(block, block_found)
    );

    let most_possible = sortBy(still_possible, ({ pos }) =>
      vec3.length(vec3.difference(pos, point_found))
    )[0];

    return {
      block: block_found,
      point: point_found,
      pos: most_possible.pos,
      face: most_possible.face,
    };
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

    // let properties = isEmpty(block.block.properties)
    //   ? ""
    //   : `[${Object.entries(block.block.properties)
    //       .map(([key, value]) => `${key}=${value}`)
    //       .join(",")}]`;

    let properties = isEmpty(block.blockstate.properties)
      ? ""
      : chat`${chat.gray("[")}${Object.entries(block.blockstate.properties).map(
          ([key, value]) =>
            chat`${chat.red(key)}${chat.gray("=")}${chat.dark_purple(value)}${chat.gray(",")}`
        )}${chat.gray("]")}`;

    player.send(chat`${chat.white(block.name)}${properties}`);
  });

  return {
    sinks: {
      entities$: new Signal.Computed(() => {
        let item_in_hard = item_in_hand$.get();
        if (item_in_hard == null) {
          return new Map();
        }
        let block = blocks[item_in_hard.item];
        if (block == null) {
          return new Map();
        }

        let sight = sight$.get();
        if (sight == null) {
          return new Map();
        }

        let { block: block_found, face, pos } = sight;

        let facedirection = Faces[face] ?? { x: 0, y: 0, z: 0 };
        let blocktoshow = vec3.add(block_found, facedirection);

        let builder = builders_by_block_type[block.definition.type];

        let state = block.states.find((x) => x.default)!;

        let other_block:
          | {
              position: Vec3;
              block: BlockState;
            }
          | undefined = undefined;

        if (builder?.build != null) {
          let changes = builder.build({
            current_blockstate: blocks["minecraft:air"].states.find(
              (x) => x.default
            )!,
            cursor: vec3.subtract(block_found, pos),
            definition: block,
            face: face as any,
            position_clicked: block_found,
            get_block: (position) =>
              world.get_block({ position: vec3.add(block_found, position) }),
          });
          // console.log(`changes:`, changes);

          let change = changes.find((x) =>
            isEqual(x.position, { x: 0, y: 0, z: 0 })
          );
          state = change?.block!;

          other_block = changes.find((x) => x !== change);
        }

        // console.log(`state:`, state);

        console.log(`other_block:`, other_block);

        let scale = 1;
        return new Map([
          [
            preview_uuid,
            {
              type: "minecraft:block_display",
              x: blocktoshow.x + 0.5,
              y: blocktoshow.y + 0.25,
              z: blocktoshow.z + 0.5,
              metadata_raw: new Map([
                [23, { type: "block_state", value: state.id }],

                // [8, { type: "varint", value: 1 }],
                // [9, { type: "varint", value: 6 }],
                // [10, { type: "varint", value: 6 }],
                [
                  11,
                  {
                    type: "vector3",
                    value: { x: -0.25, y: 0, z: -0.25 },
                  },
                ],
                [
                  12,
                  {
                    type: "vector3",
                    value: { x: 0.5, y: 0.5, z: 0.5 },
                  },
                ],

                [18, { type: "float", value: 0.2 }],
                [19, { type: "float", value: 1 }],
              ]),
            } as Entity,
          ],

          ...(other_block
            ? [
                [
                  preview2_uuid,
                  {
                    type: "minecraft:block_display",
                    x: vec3.add(blocktoshow, other_block.position).x + 0.5,
                    y: vec3.add(blocktoshow, other_block.position).y + 0.25,
                    z: vec3.add(blocktoshow, other_block.position).z + 0.5,
                    metadata_raw: new Map([
                      [
                        23,
                        { type: "block_state", value: other_block.block.id },
                      ],

                      // [8, { type: "varint", value: 1 }],
                      // [9, { type: "varint", value: 6 }],
                      // [10, { type: "varint", value: 6 }],
                      [
                        11,
                        {
                          type: "vector3",
                          value: { x: -0.25, y: 0, z: -0.25 },
                        },
                      ],
                      [
                        12,
                        {
                          type: "vector3",
                          value: { x: 0.5, y: 0.5, z: 0.5 },
                        },
                      ],

                      [18, { type: "float", value: 0.2 }],
                      [19, { type: "float", value: 1 }],
                    ]),
                  } as Entity,
                ] as const,
              ]
            : []),

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
        ]);
      }),
    },
  };
}
