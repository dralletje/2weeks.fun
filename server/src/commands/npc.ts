import { Signal } from "signal-polyfill";
import {
  Command,
  p,
  type Plugin_v1,
  type ListedPlayer,
  type Plugin_v1_Args,
} from "../Plugins/Plugin_v1.ts";
import { type Entity } from "../player-synchronizers/entities.ts";
import { entity_uuid_counter } from "../Unique.ts";
import { UUID } from "../utils/UUID.ts";
import { Mojang } from "../packages/Mojang.ts";
import { v3, v4 } from "uuid";
import { modulo_cycle } from "../utils/modulo_cycle.ts";
import { PlayPackets } from "../minecraft-protocol.ts";

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

  initial_position: {
    x: number;
    y: number;
    z: number;
  };
};

class MapStateSignal<Key, Value> extends Signal.State<Map<Key, Value>> {
  constructor(initial: Array<[Key, Value]> = []) {
    super(new Map(initial));
  }

  add(key: Key, value: Value) {
    if (this.get().has(key)) {
      throw new Error("Key already exists");
    }
    this.set(new Map([...this.get(), [key, value]]));
  }
}

type Interact = ReturnType<typeof PlayPackets.serverbound.interact.read>;
type BetterInteract = {
  entity_uuid: bigint;
  action: Interact["action"];
  sneaking: Interact["sneaking"];
};

export default function npc_plugin({ player }: Plugin_v1_Args): Plugin_v1 {
  let npc$ = new MapStateSignal<bigint, NPC>();
  let selected_npc$ = new Signal.State<bigint | null>(null);

  player.messy_events.on("interact", (event: BetterInteract) => {
    if (event.entity_uuid === selected_npc$.get()) {
      selected_npc$.set(null);
    } else if (npc$.get().has(event.entity_uuid)) {
      selected_npc$.set(event.entity_uuid);
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
                npc.texture != null
                  ? [
                      {
                        name: "textures",
                        value: npc.texture.value,
                        signature: npc.texture.signature,
                      },
                    ]
                  : [],
              listed: false,
              game_mode: "creative",
              ping: 0,
              display_name: null,
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

        // let x = npc.initial_position.x - player_position.x;
        // let y = npc.initial_position.y - player_position.y;
        // let z = npc.initial_position.z - player_position.z;

        return [
          uuid,
          {
            type: "minecraft:player",

            x: npc.position.x,
            y: npc.position.y,
            z: npc.position.z,
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
            metadata_raw: new Map([
              [0, { type: "byte", value: is_selected ? 0x40 : 0 }],
            ]),
          },
        ];
      })
    );
  });

  return {
    sinks: {
      entities$: entities$,
      listed_players$: listed_players$,
    },
    commands: [
      Command({
        command: p.command`/npc create ${p.word("Username")}`,
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
            initial_position: {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z + 2,
            },
            name: "Abracadabra",
            texture: skin_texture,
          });
        },
      }),
    ],
  };
}
