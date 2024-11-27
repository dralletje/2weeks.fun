import { Signal } from "signal-polyfill";
import {
  type Plugin_v1,
  type ListedPlayer,
  type Plugin_v1_Args,
} from "../PluginInfrastructure/Plugin_v1.ts";
import {
  type Entity,
  entity_uuid_counter,
} from "../Drivers/entities_driver.ts";
import { Mojang } from "../packages/Mojang.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import {
  type EntityMetadataEntry,
  PlayPackets,
} from "../protocol/minecraft-protocol.ts";
import { MapStateSignal } from "../packages/MapStateSignal.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import { chat } from "../utils/chat.ts";
import { TickSignal } from "../utils/TimeSignal.ts";
import { type EntityPosition } from "../PluginInfrastructure/MinecraftTypes.ts";
import { effectWithSignal } from "../utils/signals.ts";
import { vec3 } from "../utils/vec3.ts";

let error = (message: string) => {
  throw new Error(message);
};

type NPC = {
  position: {
    x: number;
    y: number;
    z: number;
    pitch: number;
    yaw: number;
    head_yaw: number;
  };
  name: string;
  texture: {
    value: string;
    signature: string;
  } | null;

  walking_to?: EntityPosition;
};

export default function npc_plugin({
  player,
  entities,
  signal,
}: Plugin_v1_Args): Plugin_v1 {
  let npc$ = new MapStateSignal<bigint, NPC>();
  let selected_npc$ = new Signal.State<bigint | null>(null);

  entities.on_interact.on(
    (event) => {
      if (event.entity_uuid === selected_npc$.get()) {
        selected_npc$.set(null);
        return null;
      } else if (npc$.get().has(event.entity_uuid)) {
        selected_npc$.set(event.entity_uuid);
        return null;
      }
    },
    { signal }
  );

  player.on_interact_v1(
    (event) => {
      let selected_npc = selected_npc$.get();
      if (selected_npc == null) {
        return;
      }

      if (event.target.type !== "block") {
        return;
      }

      let npc = npc$.get().get(selected_npc) ?? error("NPC not found");

      let to = vec3.add(event.target.position, event.target.cursor);
      npc$.set(
        new Map([
          ...npc$.get(),
          [
            selected_npc,
            {
              ...npc,
              walking_to: {
                ...npc.position,
                ...to,
              },
            },
          ],
        ])
      );
      return null;
    },
    { signal }
  );

  let ticks$ = new TickSignal(50, { signal });

  effectWithSignal(signal, () => {
    ticks$.get();

    let npcs = npc$.get();
    for (let [uuid, npc] of npcs.entries()) {
      let walking_to = npc.walking_to;
      if (walking_to != null) {
        let dx = walking_to.x - npc.position.x;
        let dy = walking_to.y - npc.position.y;
        let dz = walking_to.z - npc.position.z;

        let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
        let speed = 0.1;
        let step = speed / distance;
        let new_x = npc.position.x + dx * step;
        let new_y = npc.position.y + dy * step;
        let new_z = npc.position.z + dz * step;

        let finished = distance < speed;

        npc$.set(
          new Map([
            ...npc$.get(),
            [
              uuid,
              {
                ...npc,
                position: {
                  x: new_x,
                  y: new_y,
                  z: new_z,
                  pitch: npc.position.pitch,
                  yaw: npc.position.yaw,
                  head_yaw: npc.position.yaw,
                },
                walking_to: finished ? undefined : walking_to,
              },
            ],
          ])
        );
      }
    }
  });

  /// NOTE Listed player need to be sent before the entity....
  /// .... In the current layout there is no way to enforce this.....
  /// .... This is the only way to get the npc to show up!

  let listed_players$ = new Signal.Computed((): Map<bigint, ListedPlayer> => {
    return new Map([
      ...Array.from(npc$.get().entries()).map(
        ([uuid, npc]): [bigint, ListedPlayer] => {
          return [
            uuid,
            {
              name: npc.name,
              properties:
                npc.texture != null ?
                  [
                    {
                      name: "textures",
                      value: npc.texture.value,
                      signature: npc.texture.signature,
                    },
                  ]
                : [],
              listed: false,
              game_mode: "survival",
              ping: 0,
              // display_name: null,
              display_name: `NPC(${npc.name})`,
            },
          ];
        }
      ),
    ]);
  });

  let entities$ = new Signal.Computed((): Map<bigint, Entity> => {
    let player_position = player.position;
    let selected_npc = selected_npc$.get();

    return new Map(
      Array.from(npc$.get().entries()).map(([uuid, npc]): [bigint, Entity] => {
        let is_selected = selected_npc === uuid;

        /// Pitch from this entity to the player
        let dx = player_position.x - npc.position.x;
        let dy = player_position.y + 1.62 - (npc.position.y + 1.62);
        let dz = player_position.z - npc.position.z;
        let distance = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2);
        let pitch = Math.asin(dy / distance);
        let yaw = Math.atan2(dx, dz);

        let _pitch = -((pitch / Math.PI) * (256 / 2));
        let yaw2 = modulo_cycle((-yaw / (2 * Math.PI)) * 256, 256);

        return [
          uuid,
          {
            type: "minecraft:player",
            position: {
              x: npc.position.x,
              y: npc.position.y,
              z: npc.position.z,
            },
            // x: player.position.x,
            // y: player.position.y,
            // z: player.position.z + 2,

            pitch: _pitch,
            yaw: yaw2,
            head_yaw: yaw2,
            data: 0,
            velocity_x: 0,
            velocity_y: 0,
            velocity_z: 0,

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
        ];
      })
    );
  });

  return {
    sinks: {
      entities$: entities$,
      playerlist$: listed_players$,
    },
    commands: [
      command({
        command: c.command`/npc create ${c.word("Username")} with skin of ${c.word("Skin")}`,
        handle: async ([username, skin], { player }) => {
          let entity_id = entity_uuid_counter.get_id();

          let skin_uuid = await Mojang.get_uuid(skin);
          if (skin_uuid == null) {
            throw new CommandError(`Could not find player ${skin}`);
          }
          let skin_texture = await Mojang.get_texture(skin_uuid);
          if (skin_texture == null) {
            throw new CommandError(`Could not find skin for player ${skin}`);
          }

          npc$.add(entity_id, {
            position: {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z + 2,
              pitch: player.position.pitch,
              yaw: player.position.yaw,
              head_yaw: player.position.yaw,
            },
            name: username,
            texture: skin_texture,
          });
        },
      }),
      command({
        command: c.command`/npc create ${c.word("Username")}`,
        handle: async ([username], { player }) => {
          let entity_id = entity_uuid_counter.get_id();

          let skin_uuid = await Mojang.get_uuid(username);
          let skin_texture =
            skin_uuid != null ? await Mojang.get_texture(skin_uuid) : null;

          npc$.add(entity_id, {
            position: {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z + 2,
              pitch: player.position.pitch,
              yaw: player.position.yaw,
              head_yaw: player.position.yaw,
            },
            name: username,
            texture: skin_texture,
          });
        },
      }),
    ],
  };
}
