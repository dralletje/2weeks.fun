import { isEqual, range, zip } from "lodash-es";
import { Signal } from "signal-polyfill";
import {
  type Entity,
  entity_uuid_counter,
} from "../Drivers/entities_driver.ts";
import { emplace } from "../packages/immappable.ts";
import { Mojang } from "../packages/Mojang.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import {
  FACES,
  type EntityPosition,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import {
  type ListedPlayer,
  type Plugin_v1,
  type Plugin_v1_Args,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { type EntityMetadataEntry } from "../protocol/minecraft-protocol.ts";
import { type AnySignal } from "../utils/signals.ts";
import { type Vec3, vec3 } from "../utils/vec3.ts";
import { alexwalk } from "./pathfinding.ts/alexwalk.ts";
import { INITIAL_MOVER, move } from "./pathfinding.ts/minecraft-movement.ts";
import { raytrace } from "../utils/raytrace.ts";

let signal_from_async = <T>(fn: () => Promise<T>): AnySignal<T | null> => {
  let signal = new Signal.State<T | null>(null);
  fn().then((value) => signal.set(value));
  return signal;
};

// let NAME = "Nymeria10k";
let NAME = "notch";

export default function pathfinding_test_plugin({
  player,
  entities,
  world,
  signal,
}: Plugin_v1_Args): Plugin_v1 {
  let entity_uuid = entity_uuid_counter.get_id();

  let texture$ = signal_from_async(async () => {
    let skin_uuid = await Mojang.get_uuid(NAME);
    let skin_texture =
      skin_uuid != null ? await Mojang.get_texture(skin_uuid) : null;
    console.log(`skin_texture:`, skin_texture);
    return skin_texture;
  });

  let position$ = new Signal.State(player.position);
  // let velocity$ = new Signal.State({ x: 0, y: 0, z: 0 });
  let selected$ = new Signal.State<boolean>(false);
  let walking_to$ = new Signal.State<EntityPosition | null>(null);

  entities.on_interact.on(
    (event) => {
      if (event.entity_uuid === entity_uuid) {
        selected$.set(!selected$.get());
        return null;
      }
    },
    { signal }
  );

  player.on_interact_v1(
    (event) => {
      if (!selected$.get()) {
        return;
      }
      if (event.target.type !== "block") {
        return;
      }

      let to = vec3.add(event.target.position, event.target.cursor);
      walking_to$.set({ ...position$.get(), ...to });
      return null;
    },
    { signal }
  );

  let blocks_as_support$ = new Signal.Computed(
    () => {
      let current = position$.get();

      let in_block = vec3.subtract(current, vec3.floor(current));
      return [
        in_block.z < 0.3 && { x: 0, y: 0, z: -1 },
        { x: 0, y: 0, z: 0 },
        in_block.z > 0.7 && { x: 0, y: 0, z: 1 },
        in_block.x > 0.7 && in_block.z < 0.3 && { x: 1, y: 0, z: -1 },
        in_block.x > 0.7 && { x: 1, y: 0, z: 0 },
        in_block.x > 0.7 && in_block.z > 0.7 && { x: 1, y: 0, z: 1 },
        in_block.x < 0.3 && in_block.z < 0.3 && { x: -1, y: 0, z: -1 },
        in_block.x < 0.3 && { x: -1, y: 0, z: 0 },
        in_block.x < 0.3 && in_block.z > 0.7 && { x: -1, y: 0, z: 1 },
      ].filter((x) => x !== false);
    },
    { equals: isEqual }
  );

  let can_fall$ = new Signal.Computed(() => {
    let blocks_as_support = blocks_as_support$.get();
    let position = position$.get();

    for (let i of range(1, Math.max(position.y - world.bottom, 0))) {
      for (let block of blocks_as_support) {
        let pos = vec3.add(position, { x: block.x, y: -i, z: block.z });
        let block_below = world.get_block({
          position: vec3.floor(pos),
        });
        if (i < world.bottom) {
          throw new Error("AAAAAA");
        }
        if (!nonsolid.has(block_below.name)) {
          return i - 1 + (position.y % 1);
        }
      }
    }
    return 0;
  });

  // let ticks$ = new TickSignal(50, { signal });
  // let path_to_follow$ = new Signal.State<Array<Vec3>>([]);
  // let longjump_at$ = new Signal.State<Vec3 | null>(null);

  let mover = INITIAL_MOVER;
  let action$ = new Signal.State<
    | { type: "idle" }
    | { type: "longjump"; to: Vec3; is_in_jump: boolean }
    | { type: "path"; path: Array<Vec3> }
    | { type: "freeze" }
  >({ type: "idle" });

  let ticker = setInterval(() => {
    let position = position$.get();
    let can_fall = can_fall$.get();
    let on_ground = can_fall < 0.1;

    let action = action$.get();

    if (action.type === "longjump") {
      let npc_position = position$.get();
      let longjump_at = action.to;
      let npc_to_longjump = vec3.difference(npc_position, longjump_at);

      // if (can_fall !== 0) {
      //   action$.set({ type: "freeze" });
      //   return;
      // }

      if (action.is_in_jump) {
        if (on_ground) {
          action$.set({ type: "idle" });
          return;
        }

        let new_mover = move(mover, {
          direction: vec3.normalize({
            x: npc_to_longjump.x,
            y: 0,
            z: npc_to_longjump.z,
          }),
          movement: "sprinting",
          on_ground: on_ground,
          jump: false,
        });

        let velocity_falling_capped = {
          x: new_mover.velocity.x,
          y: Math.max(new_mover.velocity.y, -can_fall),
          z: new_mover.velocity.z,
        };

        mover = new_mover;
        position$.set({
          ...position,
          ...vec3.add(position, velocity_falling_capped),
        });
        return;
      } else if (on_ground === false) {
        let jump_mover = move(mover, {
          direction: mover.velocity,
          movement: "sprinting",
          on_ground: on_ground,
          jump: true,
        });
        mover = jump_mover;
        let velocity_falling_capped = {
          x: jump_mover.velocity.x,
          y: Math.max(jump_mover.velocity.y, -can_fall),
          z: jump_mover.velocity.z,
        };
        position$.set({
          ...position,
          ...vec3.add(position, velocity_falling_capped),
        });
        action$.set({
          type: "longjump",
          to: longjump_at,
          is_in_jump: true,
        });
      } else {
        let new_mover = move(mover, {
          direction: vec3.normalize(npc_to_longjump),
          movement: "sprinting",
          on_ground: on_ground,
          jump: false,
        });

        let velocity_falling_capped = {
          x: new_mover.velocity.x,
          y: Math.max(new_mover.velocity.y, -can_fall),
          z: new_mover.velocity.z,
        };

        mover = new_mover;
        position$.set({
          ...position,
          ...vec3.add(position, velocity_falling_capped),
        });
      }

      /// We passed the point, actually jump instead
      // if (vec3.dot(new_mover.velocity, npc_to_longjump) < 0) {
      //   console.log("JUMP!");
      //   console.log(`on_ground:`, on_ground);
      //   let jump_mover = move(mover, {
      //     direction: vec3.normalize(npc_to_longjump),
      //     movement: "sprinting",
      //     on_ground: on_ground,
      //     jump: true,
      //   });
      //   mover = jump_mover;
      //   action$.set({
      //     type: "longjump",
      //     to: longjump_at,
      //     is_in_jump: true,
      //   });
      //   position$.set({
      //     ...position,
      //     ...vec3.add(position, jump_mover.velocity),
      //   });
      // } else {
      //   mover = new_mover;
      //   position$.set({
      //     ...position,
      //     ...vec3.add(position, new_mover.velocity),
      //   });
      // }
    } else if (action.type === "idle") {
      let new_mover = move(mover, {
        direction: { x: 1, y: 0, z: 0 },
        movement: "stopping",
        on_ground: on_ground,
        jump: false,
      });

      let velocity_falling_capped = {
        x: new_mover.velocity.x,
        y: Math.max(new_mover.velocity.y, -can_fall),
        z: new_mover.velocity.z,
      };

      mover = new_mover;
      position$.set({
        ...position,
        ...vec3.add(position, velocity_falling_capped),
      });
    } else if (action.type === "path") {
      if (action.path.length === 0) {
        action$.set({ type: "idle" });
        return;
      }

      let path_to_follow = action.path;
      let next = vec3.add(path_to_follow[0], { x: 0.5, y: 0, z: 0.5 });
      // console.log(
      //   ` vec3.length({ ...vec3.subtract(next, position), y: 0 }):`,
      //   vec3.length({ ...vec3.subtract(next, position), y: 0 })
      // );
      // console.log(`Math.floor(next.y):`, Math.floor(next.y));
      // console.log(`Math.floor(position.y):`, Math.floor(position.y));
      if (
        vec3.length({ ...vec3.subtract(next, position), y: 0 }) < 0.8 &&
        next.y - 0.2 < position.y &&
        position.y < next.y + 1.2
      ) {
        action$.set({
          type: "path",
          path: path_to_follow.slice(1),
        });
        next = vec3.add(path_to_follow[0], { x: 0.5, y: 0, z: 0.5 });
      }

      let delta = vec3.subtract(next, position);
      let direction = vec3.normalize(delta);
      let horizontal_distance2 = vec3.length2({ x: delta.x, y: 0, z: delta.z });

      if (delta.y > 0) {
        console.log(
          `vec3.length({ ...d, y: 0 }):`,
          vec3.length({ ...mover.velocity, y: 0 })
        );
      }

      // console.log(`next:`, next);
      // console.log(`position:`, position);
      // console.log(`delta:`, delta);
      // console.log(`delta.y > 0:`, delta.y > 0);
      // console.log(`horizontal_distance2 < 2:`, horizontal_distance2 < 2);
      // console.log(`on_ground:`, on_ground);
      // console.log(
      //   `vec3.length({ ...mover.velocity, y: 0 }) > 0.3:`,
      //   vec3.length({ ...mover.velocity, y: 0 }) > 0.3
      // );

      // console.log(
      //   `vec3.length({ ...mover.velocity, y: 0 }):`,
      //   vec3.length({ ...mover.velocity, y: 0 })
      // );

      let new_mover =
        delta.y > 0.8 && horizontal_distance2 < 2.5 && on_ground
          ? move(mover, {
              direction: direction,
              movement: "stopping",
              on_ground: on_ground,
              jump: true,
            })
          : move(mover, {
              direction: direction,
              movement: "walking",
              on_ground: on_ground,
              jump: false,
            });

      // if (new_mover.velocity.y > 0) {
      //   console.log(`direction:`, direction);
      //   console.log("new mover:", new_mover);
      // }

      let velocity_falling_capped = {
        x: new_mover.velocity.x,
        y: Math.max(new_mover.velocity.y, -can_fall),
        z: new_mover.velocity.z,
      };

      let yaw = Math.atan2(direction.x, direction.z);
      let pitch = Math.asin(direction.y);

      mover = new_mover;
      position$.set({
        ...position,
        ...vec3.add(position, velocity_falling_capped),
        yaw: yaw,
        pitch: pitch,
      });
    } else if (action.type === "freeze") {
      // Nothing happens!
    }
  }, 50);
  // let ticker = setInterval(() => {
  //   let next_velocity = velocity$.get();
  //   let yaw = position$.get().yaw;
  //   let pitch = position$.get().pitch;

  //   /// Drag and such
  //   next_velocity = vec3.scale(next_velocity, 0.89);

  //   let can_fall = can_fall$.get();

  //   let path_to_follow = path_to_follow$.get();
  //   if (path_to_follow.length !== 0) {
  //     let current = position$.get();
  //     let next = path_to_follow[0];
  //     let next_next = path_to_follow[1];

  //     let delta = vec3.subtract(
  //       vec3.add(next, { x: 0.5, y: 0, z: 0.5 }),
  //       current
  //     );

  //     if (vec3.length(delta) < 0.6) {
  //       path_to_follow$.set(path_to_follow.slice(1));
  //       // if (next_next != null) {
  //       //   let angle_to_nextnext = vec3.dot(
  //       //     vec3.normalize(next_velocity),
  //       //     vec3.normalize(vec3.subtract(next_next, next))
  //       //   );
  //       //   console.log(`angle_to_nextnext:`, angle_to_nextnext);
  //       //   if (angle_to_nextnext < 0.5) {
  //       //     next_velocity = vec3.scale(next_velocity, 0.1);
  //       //   }
  //       // }

  //       // position$.set({
  //       //   ...new_position,
  //       //   yaw: yaw,
  //       //   pitch: pitch,
  //       // });
  //     }

  //     let direction = vec3.normalize(delta);
  //     let distance = vec3.length(delta);

  //     if (can_fall < 0.2) {
  //       next_velocity = vec3.add(
  //         vec3.scale(next_velocity, 0.05),
  //         vec3.scale(direction, 0.5)
  //       );

  //       if (distance > 1) {
  //         if (direction.y > 0) {
  //           console.log(`direction.y:`, direction.y);
  //           next_velocity = {
  //             ...vec3.scale(delta, 0.1),
  //             // ...next_velocity,
  //             y: distance ** 1,
  //           };
  //         } else if (direction.y < 0) {
  //           next_velocity = {
  //             ...vec3.add(next_velocity, vec3.scale(delta, 0.1)),
  //             y: distance / 2,
  //           };
  //         }
  //       }
  //     } else {
  //       next_velocity = vec3.add(
  //         vec3.scale(next_velocity, 0.1),
  //         vec3.scale(direction, 0.5)
  //       );

  //       if (direction.y > 0) {
  //       }
  //     }

  //     // if (next_next) {
  //     //   let next_delta = vec3.subtract(
  //     //     vec3.add(next_next, { x: 0.5, y: 0, z: 0.5 }),
  //     //     next
  //     //   );
  //     //   let angle = Math.acos(
  //     //     vec3.dot(vec3.normalize(delta), vec3.normalize(next_delta))
  //     //   );

  //     //   let max_speed_to_make_angle = 0.1 / Math.sin(angle / 2);

  //     //   if (distance < 0.5) {
  //     //     let speed = vec3.length(next_velocity);
  //     //     next_velocity = vec3.scale(
  //     //       next_velocity,
  //     //       max_speed_to_make_angle / speed
  //     //     );
  //     //   }
  //     // }

  //     // if (
  //     //   vec3.dot(
  //     //     vec3.difference(next, vec3.add(current, next_velocity)),
  //     //     direction
  //     //   ) > 0
  //     // ) {
  //     //   // if (distance < vec3.length(next_velocity)) {
  //     //   path_to_follow$.set(path_to_follow.slice(1));
  //     //   // return;
  //     // }

  //     yaw = Math.atan2(direction.x, direction.z);
  //     pitch = Math.asin(direction.y);
  //   } else {
  //     next_velocity = vec3.scale(next_velocity, 0.3);
  //   }

  //   if (can_fall > 0) {
  //     next_velocity = vec3.add(next_velocity, { x: 0, y: -0.3, z: 0 });
  //   }

  //   next_velocity = {
  //     ...next_velocity,
  //     y: Math.max(next_velocity.y, -can_fall),
  //   };

  //   //  next_velocity =

  //   let new_position = vec3.add(position$.get(), next_velocity);
  //   velocity$.set(next_velocity);
  //   position$.set({
  //     ...new_position,
  //     yaw: yaw,
  //     pitch: pitch,
  //   });
  // }, 50);

  signal.addEventListener("abort", () => {
    clearInterval(ticker);
  });

  let nonsolid = new Set([
    "minecraft:air",
    "minecraft:sugar_cane",
    "minecraft:water",
    "minecraft:tall_grass",
    "minecraft:short_grass",
    "minecraft:rose_bush",
  ]);

  // let path$ = new Signal.Computed(() => {
  let path$ = alexwalk({
    world: world,
    from$: position$,
    to$: { get: () => player.position },
    limit: 20000,
  });

  let listed_players$ = new Signal.Computed((): Map<bigint, ListedPlayer> => {
    let texture = texture$.get();
    if (texture == null) {
      return new Map();
    }

    return new Map([
      [
        entity_uuid,
        {
          name: NAME,
          properties:
            texture != null
              ? [
                  {
                    name: "textures",
                    value: texture.value,
                    signature: texture.signature,
                  },
                ]
              : [],
          listed: false,
          game_mode: "survival",
          ping: 0,
          // display_name: null,
          display_name: `NPC(${NAME})`,
        } as ListedPlayer,
      ],
    ]);
  });

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    if (texture$.get() == null) {
      return new Map();
    }

    let player_position = player.position;
    let is_selected = selected$.get();
    let position = position$.get();
    let action = action$.get();
    let path_to_follow = action.type === "path" ? action.path : [];

    /// Pitch from this entity to the player
    let dx = player_position.x - position.x;
    let dy = player_position.y + 1.62 - (position.y + 1.62);
    let dz = player_position.z - position.z;
    let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
    let pitch = Math.asin(dy / distance);
    let yaw = Math.atan2(dx, dz);

    // let _pitch = -((pitch / Math.PI) * (256 / 2));
    // let yaw2 = modulo_cycle((-yaw / (2 * Math.PI)) * 256, 256);

    let pitch3 = path_to_follow.length === 0 ? pitch : position.pitch;
    let yaw3 = path_to_follow.length === 0 ? yaw : position.yaw;

    return new Map([
      [
        entity_uuid,
        {
          type: "minecraft:player",
          position: position,
          pitch: pitch3,
          yaw: yaw3,
          head_yaw: yaw3,
          equipment: {
            main_hand: {
              item: "minecraft:stick",
              count: 1,
            },
          },
          metadata_raw: new Map<number, EntityMetadataEntry["value"]>([
            [2, { type: "optional_chat", value: "sneaking" }],
            [3, { type: "boolean", value: true }],
            // [10, { type: "varint", value: 1 }],
            // [12, { type: "varint", value: 20 }],
            [0, { type: "byte", value: is_selected ? 0x40 : 0 }],
            [18, { type: "byte", value: 0 }],
          ]),
        },
      ],
    ]);
  });

  let path_entities_ids = new Map<number, bigint>();
  let path_entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    let action = action$.get();

    // let path = path_to_follow$.get();

    if (action.type === "path" && action.path.length !== 0) {
      let path = action.path;
      return new Map(
        zip(path.slice(0, -1), path.slice(1)).map(
          ([_position, _next], index) => {
            let position = _position!;
            let next = _next!;

            let yaw = Math.atan2(next.x - position.x, next.z - position.z);
            let pitch = Math.asin(
              (next.y - position.y) /
                vec3.length(vec3.difference(next, position))
            );

            return [
              emplace(path_entities_ids, index, {
                insert: () => entity_uuid_counter.get_id(),
              }),
              {
                type: "minecraft:allay",
                position: {
                  ...vec3.add(position, { x: 0.5, y: 0.5, z: 0.5 }),
                },
                yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
                pitch: -((pitch * (180 / Math.PI)) / 360) * 256,
                head_yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
                metadata_raw: new Map([[0, { type: "byte", value: 0x40 }]]),
              } satisfies Entity,
            ];
          }
        )
      );
    } else {
      let path_promised = path$.get();
      if (path_promised.loading) return new Map();
      if (path_promised.value == null) return new Map();

      let path = path_promised.value;

      return new Map(
        zip(path.slice(1, -1), path.slice(2)).map(
          ([_position, _next], index) => {
            let position = _position!;
            let next = _next!;

            let yaw = Math.atan2(next.x - position.x, next.z - position.z);
            let pitch = Math.asin(
              (next.y - position.y) /
                vec3.length(vec3.difference(next, position))
            );

            return [
              emplace(path_entities_ids, index, {
                insert: () => entity_uuid_counter.get_id(),
              }),
              {
                type: "minecraft:allay",
                position: {
                  ...vec3.add(position, { x: 0.5, y: 0.5, z: 0.5 }),
                },
                yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
                pitch: -((pitch * (180 / Math.PI)) / 360) * 256,
                head_yaw: -((yaw * (180 / Math.PI)) / 360) * 256,
              } satisfies Entity,
            ];
          }
        )
      );
    }
  });

  return {
    sinks: {
      entities$: new Signal.Computed(() => {
        return new Map([...entities$.get(), ...path_entities$.get()]);
      }),
      playerlist$: listed_players$,
    },
    commands: [
      command({
        command: c.command`/here`,
        handle: ([], { player }) => {
          position$.set(player.position);
          action$.set({ type: "idle" });
        },
      }),
      command({
        command: c.command`/longjump`,
        handle: ([], { player }) => {
          let from = position$.get();
          let to = player.position;

          if (Math.floor(from.y) !== Math.floor(to.y)) {
            throw new CommandError("Cannot longjump up or down");
          }

          let first_air_block: Vec3 | null = null;
          for (let { block, with_face } of raytrace({
            origin: vec3.add(from, FACES.bottom),
            direction: vec3.normalize(vec3.difference(from, to)),
            max_distance: 20,
          })) {
            let material = world.get_block({ position: block });
            if (material.name === "minecraft:air") {
              first_air_block = with_face().face_hit_point;
            }
          }
          if (first_air_block == null) {
            throw new CommandError("No air block found");
          }

          let jump_position = {
            x: first_air_block.x,
            y: Math.ceil(first_air_block.y),
            z: first_air_block.z,
          };

          action$.set({
            type: "longjump",
            to: jump_position,
            is_in_jump: false,
          });
        },
      }),
      command({
        command: c.command`/come`,
        handle: ([], { player }) => {
          let position = player.position;
          let position_block = vec3.floor(position);
          let path = path$.get();

          if (path?.loading) {
            throw new CommandError("Pathfinding still loading");
          }
          if (path.value == null) {
            throw new CommandError("No path found");
          }

          // path_to_follow$.set(path.value);
          action$.set({
            type: "path",
            path: path.value,
          });
        },
      }),
      command({
        command: c.command`/freeze`,
        handle: ([], { player }) => {
          action$.set({ type: "freeze" });
        },
      }),
      command({
        command: c.command`/idle`,
        handle: ([], { player }) => {
          action$.set({ type: "idle" });
        },
      }),
    ],
  };
}
