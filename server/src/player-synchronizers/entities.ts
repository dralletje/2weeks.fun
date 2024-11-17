import { registries } from "@2weeks/minecraft-data";
import { emplace, map_difference } from "../immappable.ts";
import {
  type EntityMetadataEntry,
  PlayPackets,
} from "../minecraft-protocol.ts";
import { type AnySignal, effect } from "../signals.ts";
import { entity_id_counter } from "../Unique.ts";
import { isEqual } from "lodash-es";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { BasicPlayer, type Slot } from "../BasicPlayer.ts";

type MetadataMap = Map<number, EntityMetadataEntry["value"]>;

export type Entity = {
  type: string;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  head_yaw: number;
  data: number;
  velocity_x: number;
  velocity_y: number;
  velocity_z: number;

  equipment?: {
    main_hand?: Slot;
    off_hand?: Slot;
    helmet?: Slot;
    chestplate?: Slot;
    leggings?: Slot;
    boots?: Slot;
  };

  metadata_raw?: MetadataMap;
};

export let entities_synchronizer = ({
  entities$,
  minecraft_socket,
  player,
  signal,
}: {
  entities$: AnySignal<Map<bigint, Entity>>;
  minecraft_socket: MinecraftPlaySocket;
  player: BasicPlayer;
  signal: AbortSignal;
}) => {
  let uuid_to_id = new Map<bigint, number>();
  let current_entities = new Map<bigint, Entity>();

  minecraft_socket.on_packet["minecraft:interact"].on(
    (packet) => {
      let { action, sneaking, entity_id } =
        PlayPackets.serverbound.interact.read(packet);

      let entity_uuid = Array.from(uuid_to_id.entries()).find(
        ([uuid, id]) => id === entity_id
      )?.[0];
      if (entity_uuid == null) {
        throw new Error(`Entity not found: ${entity_id}`);
      }

      player.messy_events.emit("interact", {
        action,
        sneaking,
        entity_uuid: entity_uuid,
      });
    },
    { signal: signal }
  );

  effect(() => {
    let expected_entities = entities$.get();

    let difference = map_difference(current_entities, expected_entities);
    current_entities = expected_entities;

    //////////////////////////////////////////////////////////
    /// REMOVE
    //////////////////////////////////////////////////////////
    if (difference.removed.size > 0) {
      let entity_ids = Array.from(difference.removed.keys()).map((uuid) => {
        let id = uuid_to_id.get(uuid);
        if (!id) {
          throw new Error(`Entity not found: ${uuid}`);
        }
        return id;
      });

      for (let [uuid] of difference.removed) {
        uuid_to_id.delete(uuid);
      }

      minecraft_socket.write(
        PlayPackets.clientbound.remove_entities.write({
          entities: entity_ids,
        })
      );
    }

    //////////////////////////////////////////////////////////
    /// ADDED
    //////////////////////////////////////////////////////////
    for (let [uuid, entity] of difference.added) {
      let type = registries["minecraft:entity_type"].entries[entity.type];
      if (!type) {
        throw new Error(`Unknown entity type: ${entity.type}`);
      }

      minecraft_socket.write(
        PlayPackets.clientbound.bundle_delimiter.write({})
      );

      let id = emplace(uuid_to_id, uuid, {
        insert: () => entity_id_counter.get_id(),
      });

      minecraft_socket.write(
        PlayPackets.clientbound.add_entity.write({
          entity_id: id,
          entity_uuid: uuid,
          type: type.protocol_id,
          x: entity.x,
          y: entity.y,
          z: entity.z,
          pitch: entity.pitch,
          yaw: entity.yaw,
          head_yaw: entity.head_yaw,
          data: entity.data,
          velocity_x: entity.velocity_x,
          velocity_y: entity.velocity_y,
          velocity_z: entity.velocity_z,
        })
      );

      if (entity.metadata_raw) {
        minecraft_socket.write(
          PlayPackets.clientbound.set_entity_data.write({
            entity_id: id,
            metadata: Array.from(entity.metadata_raw).map(([index, value]) => ({
              index,
              value,
            })),
          })
        );
      }

      for (let [slot_name, slot] of [
        ["main_hand", entity.equipment?.main_hand],
        ["off_hand", entity.equipment?.off_hand],
        ["helmet", entity.equipment?.helmet],
        ["chestplate", entity.equipment?.chestplate],
        ["leggings", entity.equipment?.leggings],
        ["boots", entity.equipment?.boots],
      ] as const) {
        // console.log(`slot_name, slot:`, slot_name, slot);
        if (slot) {
          minecraft_socket.write(
            PlayPackets.clientbound.set_equipment.write({
              entity_id: id,
              equipment: [
                {
                  slot: slot_name,
                  data: {
                    type: 1,
                    value: {
                      item_id:
                        registries["minecraft:item"].entries[slot.item]
                          .protocol_id,
                      components: {
                        added: [],
                        removed: [],
                      },
                    },
                  },
                },
              ],
            })
          );
        }
      }

      minecraft_socket.write(
        PlayPackets.clientbound.bundle_delimiter.write({})
      );
    }

    //////////////////////////////////////////////////////////
    /// UPDATE
    //////////////////////////////////////////////////////////
    for (let [uuid, [from, to]] of difference.stayed) {
      minecraft_socket.write(
        PlayPackets.clientbound.bundle_delimiter.write({})
      );

      //////////// POSITION
      let rot_changed = to.pitch !== from.pitch || to.yaw !== from.yaw;
      let pos_changed = to.x !== from.x || to.y !== from.y || to.z !== from.z;

      let id = emplace(uuid_to_id, uuid, {
        insert: () => entity_id_counter.get_id(),
      });

      let send_delta =
        pos_changed &&
        Math.abs(to.x - from.x) < 7.999 &&
        Math.abs(to.y - to.y) < 7.999 &&
        Math.abs(to.z - from.z) < 7.999;

      if (send_delta) {
        let delta_x = to.x * 4096 - from.x * 4096;
        let delta_y = to.y * 4096 - from.y * 4096;
        let delta_z = to.z * 4096 - from.z * 4096;
        if (rot_changed) {
          minecraft_socket.write(
            PlayPackets.clientbound.move_entity_pos_rot.write({
              entity_id: id,
              delta_x: delta_x,
              delta_y: delta_y,
              delta_z: delta_z,
              on_ground: true,
              pitch: Math.floor(to.pitch),
              yaw: Math.floor(to.yaw),
            })
          );
        } else {
          minecraft_socket.write(
            PlayPackets.clientbound.move_entity_pos.write({
              entity_id: id,
              delta_x: delta_x,
              delta_y: delta_y,
              delta_z: delta_z,
              on_ground: true,
            })
          );
        }
      } else {
        if (pos_changed) {
          /// TODO Do move_entity_pos when distance is small enough?
          // minecraft_socket.write(
          //   PlayPackets.clientbound.move_entity_pos.write({
          //     entity_id: id,
          //     delta_x: to.x - from.x,
          //     delta_y: to.y - from.y,
          //     delta_z: to.z - from.z,
          //     on_ground: true,
          //   })
          // );
          minecraft_socket.write(
            PlayPackets.clientbound.teleport_entity.write({
              entity_id: id,
              x: to.x,
              y: to.y,
              z: to.z,
              yaw: Math.floor(to.yaw),
              pitch: Math.floor(to.pitch),
              on_ground: true,
            })
          );
        }

        if (rot_changed) {
          minecraft_socket.write(
            PlayPackets.clientbound.move_entity_rot.write({
              entity_id: id,
              pitch: Math.floor(to.pitch),
              yaw: Math.floor(to.yaw),
              on_ground: true,
            })
          );
        }
      }

      if (to.head_yaw !== from.head_yaw) {
        minecraft_socket.write(
          PlayPackets.clientbound.rotate_head.write({
            entity_id: id,
            head_yaw: to.head_yaw,
          })
        );
      }

      //////////// METADATA
      let metadata_diff = map_difference(
        from.metadata_raw ?? (new Map() as MetadataMap),
        to.metadata_raw ?? (new Map() as MetadataMap)
      );
      /// TODO Can't do remove yet...
      /// .... Would have to know default values...

      let metadata_changes = [
        ...metadata_diff.added,
        ...Array.from(metadata_diff.stayed)
          .filter(([index, [from, to]]) => !isEqual(from, to))
          .map(([index, [from, to]]) => [index, to] as const),
      ];
      if (metadata_changes.length > 0) {
        minecraft_socket.write(
          PlayPackets.clientbound.set_entity_data.write({
            entity_id: id,
            metadata: metadata_changes.map(([index, value]) => ({
              index,
              value,
            })),
          })
        );
      }

      //////////// EQUIPMENT
      let changed_slots = (
        [
          ["main_hand", from.equipment?.main_hand, to.equipment?.main_hand],
          ["off_hand", from.equipment?.main_hand, to.equipment?.off_hand],
          ["helmet", from.equipment?.main_hand, to.equipment?.helmet],
          ["chestplate", from.equipment?.main_hand, to.equipment?.chestplate],
          ["leggings", from.equipment?.main_hand, to.equipment?.leggings],
          ["boots", from.equipment?.main_hand, to.equipment?.boots],
        ] as const
      ).filter(
        ([slot_name, from_slot, to_slot]) => !isEqual(from_slot, to_slot)
      );

      minecraft_socket.write(
        PlayPackets.clientbound.set_equipment.write({
          entity_id: id,
          equipment: changed_slots.map(([slot_name, from_slot, to_slot]) => ({
            slot: slot_name,
            data: {
              type: 1,
              value:
                to_slot == null
                  ? {
                      item_id: 0,
                      components: {
                        added: [],
                        removed: [],
                      },
                    }
                  : {
                      item_id:
                        registries["minecraft:item"].entries[to_slot.item]
                          .protocol_id,
                      components: {
                        added: [],
                        removed: [],
                      },
                    },
            },
          })),
        })
      );

      minecraft_socket.write(
        PlayPackets.clientbound.bundle_delimiter.write({})
      );
    }
  });
};
