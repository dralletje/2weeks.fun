import { Signal } from "signal-polyfill";
import { type Slot } from "../BasicPlayer.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { chat } from "../utils/chat.ts";
import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";
import { vec3, type Vec3 } from "../utils/vec3.ts";
import { range } from "lodash-es";
import { type Entity } from "../Drivers/entities_driver.ts";
import { entity_id_counter, entity_uuid_counter } from "../Unique.ts";
import { blocks, type BlockState } from "@2weeks/minecraft-data";
import { modulo_cycle } from "../utils/modulo_cycle.ts";

let cube_lines = (from: Vec3, to: Vec3) => {
  let simple_lines = [
    // front_bottom_right
    [
      [0, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
    ],

    // front_top_left
    [
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 1],
      [1, 1, 1],
    ],

    // back_bottom_left
    [
      [1, 0, 1],
      [1, 0, 0],
    ],
    [
      [1, 0, 1],
      [1, 1, 1],
    ],
    [
      [1, 0, 1],
      [0, 0, 1],
    ],

    // back_top_right
    [
      [1, 1, 0],
      [1, 1, 1],
    ],
    [
      [1, 1, 0],
      [1, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 1, 0],
    ],
  ];

  let diff = vec3.difference(from, to);

  return simple_lines.map(([line_from, line_to]) => {
    return [
      vec3.add(
        from,
        vec3.multiplyVec3(diff, {
          x: line_from[0],
          y: line_from[1],
          z: line_from[2],
        })
      ),
      vec3.add(
        from,
        vec3.multiplyVec3(diff, { x: line_to[0], y: line_to[1], z: line_to[2] })
      ),
    ];
  });
};

let MAX_ENTITIES = 20;
let get_line_points = ({
  count,
  from: from_location,
  to: to_location,
}: {
  count: number;
  from: Vec3;
  to: Vec3;
}) => {
  let item_count = Math.ceil(
    Math.max(
      Math.min(
        MAX_ENTITIES,
        vec3.length(vec3.difference(from_location, to_location)) * count
      ),
      2
    )
  );
  let diff_vector = vec3.multiply(
    vec3.difference(from_location, to_location),
    1 / item_count
  );

  return range(0, item_count + 1).map((i) => {
    let next_point_relative = vec3.multiply(diff_vector, i);
    let location = vec3.add(from_location, next_point_relative);
    return location;
  });
};

export default function worldedit_plugin({
  player,
  signal,
  world,
}: Plugin_v1_Args): Plugin_v1 {
  let position_1$ = new Signal.State<Position | null>(null);
  let position_2$ = new Signal.State<Position | null>(null);

  player.on_interact_v1(
    ({ item, type, target }) => {
      if (target.type === "entity") {
        return;
      }

      if (item?.properties?.custom_data?.type === "dral:worldedit_wand") {
        if (type === "left_click") {
          player.send(chat.green(`* Set position 1`));
          position_1$.set(target.position);
        } else if (type === "right_click") {
          player.send(chat.green(`* Set position 2`));
          position_2$.set(target.position);
        }
        return null;
      }
    },
    { signal }
  );

  let glass_uuid = entity_uuid_counter.get_id();

  let set = ({ block }: { block: BlockState }) => {
    let pos1 = position_1$.get();
    let pos2 = position_2$.get();

    if (pos1 == null || pos2 == null) {
      throw new CommandError("No positions set");
    }

    let [low, high] = vec3.lowhigh(pos1, pos2);

    let changes = range(low.x, high.x + 1).flatMap((x) =>
      range(low.y, high.y + 1).flatMap((y) =>
        range(low.z, high.z + 1).map((z) => ({ x, y, z }))
      )
    );

    world.set_blocks({
      blocks: changes.map(({ x, y, z }) => ({
        position: { x, y: modulo_cycle(y, 16), z },
        blockstate: block.id,
      })),
      transaction_id: 0,
    });

    // for (let { x, y, z } of changes) {
    //   world.set_block({
    //     position: { x, y, z },
    //     block: block.id,
    //     transaction_id: 0,
    //   });
    // }
  };

  return {
    sinks: {
      // entities$: new Signal.Computed(() => {
      //   let selected_item =
      //     player.hotbar$.get()[player.selected_hotbar_slot$.get()];
      //   if (
      //     selected_item?.properties?.custom_data?.type !== "dral:worldedit_wand"
      //   ) {
      //     return new Map();
      //   }

      //   let pos1 = position_1$.get();
      //   let pos2 = position_2$.get();
      //   if (pos1 == null || pos2 == null) {
      //     return new Map();
      //   }

      //   let lines = cube_lines(pos1, pos2).map(([from, to]) =>
      //     get_line_points({ count: 1, from, to })
      //   );

      //   console.log(`lines:`, lines);

      //   let entities = new Map(
      //     lines.flatMap((line, i) => {
      //       return line.map((position, j) => {
      //         return [
      //           entity_uuid_counter.get_id(),
      //           {
      //             type: "minecraft:snowball",
      //             x: position.x,
      //             y: position.y,
      //             z: position.z,

      //             yaw: 0,
      //             head_yaw: 0,
      //             pitch: 0,
      //             data: 0,
      //             velocity_x: 0,
      //             velocity_y: 0,
      //             velocity_z: 0,

      //             metadata_raw: new Map([
      //               [5, { type: "boolean", value: true }],
      //             ]),
      //           },
      //         ] as [bigint, Entity];
      //       });
      //     })
      //   );
      //   return entities;
      // }),
      entities$: new Signal.Computed(() => {
        let selected_item =
          player.hotbar$.get()[player.selected_hotbar_slot$.get()];
        if (
          selected_item?.properties?.custom_data?.type !== "dral:worldedit_wand"
        ) {
          return new Map();
        }

        let pos1 = position_1$.get();
        let pos2 = position_2$.get();
        if (pos1 == null || pos2 == null) {
          return new Map();
        }

        let [low, high] = vec3.lowhigh(pos1, pos2);

        let difference = vec3.add(vec3.difference(low, high), {
          x: 1,
          y: 1,
          z: 1,
        });

        let blockid = blocks["minecraft:red_stained_glass"].states.find(
          (x) => x.default
        )?.id;

        return new Map([
          [
            glass_uuid,
            {
              type: "minecraft:block_display",
              x: low.x - 0.01,
              y: low.y - 0.01,
              z: low.z - 0.01,

              yaw: 0,
              head_yaw: 0,
              pitch: 0,
              data: 0,
              velocity_x: 0,
              velocity_y: 0,
              velocity_z: 0,

              metadata_raw: new Map([
                [0, { type: "byte", value: 0x40 }],
                [23, { type: "block_state", value: blockid! }],
                [
                  12,
                  {
                    type: "vector3",
                    value: vec3.add(difference, { x: 0.02, y: 0.02, z: 0.02 }),
                  },
                ],
                // [20, { type: "float", value: 5 }],
              ]),
            } satisfies Entity,
          ],
        ]);
      }),
    },
    commands: [
      command({
        command: c.command`//set`,
        handle: () => {
          let slot = player.hotbar$.get()[player.selected_hotbar_slot$.get()];

          if (slot == null) {
            throw new CommandError("No item in hand");
          }
          let block = blocks[slot.item];
          if (block == null) {
            throw new CommandError("Invalid block");
          }
          let state = blocks[slot.item]?.states.find((x) => x.default);
          if (state == null) {
            throw new CommandError("Invalid block");
          }

          set({ block: state });

          player.send(chat.green(`* Set blocks to ${block.definition.type}`));
        },
      }),
      command({
        command: c.command`//set ${c.block_state("Block")}`,
        handle: ([block]) => {
          set({ block: block.state });

          player.send(chat.yellow(`* Set blocks to ${block.name}`));
        },
      }),
      command({
        command: c.command`//expand ${c.integer("count")} up`,
        handle: ([count]) => {
          let pos1 = position_1$.get();
          let pos2 = position_2$.get();

          if (pos1 == null || pos2 == null) {
            throw new CommandError("No positions set");
          }

          if (pos1.y > pos2.y) {
            position_1$.set({ ...pos1, y: pos1.y + count });
          } else {
            position_2$.set({ ...pos2, y: pos2.y + count });
          }

          player.send(chat.yellow(`* Expanded up ${count} blocks`));
        },
      }),
      command({
        command: c.command`//wand`,
        handle: () => {
          player.hotbar$.set(
            player.hotbar$
              .get()
              .toSpliced(player.selected_hotbar_slot$.get(), 1, {
                count: 1,
                item: "minecraft:wooden_axe",
                properties: {
                  custom_data: {
                    type: "dral:worldedit_wand",
                  },
                  item_name: "Worldedit Wand",
                  lore: [
                    "Left click to set position 1",
                    "Right click to set position 2",
                  ],
                  enchantment_glint_override: true,
                },
              }) as any
          );
          player.send(chat.green(`* Got you a wand`));
        },
      }),
    ],
  };
}
