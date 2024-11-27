import { registries } from "@2weeks/minecraft-data";
import { emplace, map_difference } from "../packages/immappable.ts";
import {
  type EntityMetadataEntry,
  PlayPackets,
} from "../protocol/minecraft-protocol.ts";
import { BigIntCounter, NumberCounter } from "../utils/Unique.ts";
import { isEqual } from "lodash-es";
import { MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { type Slot } from "../PluginInfrastructure/BasicPlayer.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import {
  StoppableHookableEvent,
  StoppableHookableEventController,
} from "../packages/stopable-hookable-event.ts";

export type EntityMetadataMap = Map<number, EntityMetadataEntry["value"]>;

export let entity_id_counter = new NumberCounter();
export let entity_uuid_counter = new BigIntCounter();

export type Entity = {
  type: RegistryResourceKey<"minecraft:entity_type">;
  position: {
    x: number;
    y: number;
    z: number;
  };
  pitch?: number;
  yaw?: number;
  head_yaw?: number;
  data?: number;
  velocity_x?: number;
  velocity_y?: number;
  velocity_z?: number;

  equipment?: {
    main_hand?: Slot;
    off_hand?: Slot;
    helmet?: Slot;
    chestplate?: Slot;
    leggings?: Slot;
    boots?: Slot;
  };

  metadata_raw?: EntityMetadataMap;
};

type EntityInteractAction =
  | {
      type: "interact";
      value: {
        hand: "main_hand" | "off_hand";
      };
    }
  | {
      type: "attack";
      value: void;
    }
  | {
      type: "interact_at";
      value: {
        hand: "main_hand" | "off_hand";
        x: number;
        y: number;
        z: number;
      };
    };

export type EntityInteractEvent = {
  action: EntityInteractAction;
  sneaking: boolean;
  entity_uuid: bigint;
};

export type EntityDriverOutput = {
  on_interact: StoppableHookableEvent<EntityInteractEvent>;
};

export let makeEntitiesDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<Map<bigint, Entity>, EntityDriverOutput> => {
  return ({ input$, effect, signal }) => {
    let uuid_to_id = new Map<bigint, number>();
    let current_entities = new Map<bigint, Entity>();

    effect(() => {
      let expected_entities = new Map(
        input$.get().flatMap((x) => Array.from(x.entries()))
      );
      // console.log(`expected_entities:`, expected_entities);

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

        minecraft_socket.send(
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

        minecraft_socket.send(
          PlayPackets.clientbound.bundle_delimiter_optimised
        );

        let id = emplace(uuid_to_id, uuid, {
          insert: () => entity_id_counter.get_id(),
        });

        minecraft_socket.send(
          PlayPackets.clientbound.add_entity.write({
            entity_id: id,
            entity_uuid: uuid,
            type: type.protocol_id,
            x: entity.position.x,
            y: entity.position.y,
            z: entity.position.z,
            pitch: entity.pitch ?? 0,
            yaw: entity.yaw ?? 0,
            head_yaw: entity.head_yaw ?? 0,
            data: entity.data ?? 0,
            velocity_x: entity.velocity_x ?? 0,
            velocity_y: entity.velocity_y ?? 0,
            velocity_z: entity.velocity_z ?? 0,
          })
        );

        if (entity.metadata_raw) {
          minecraft_socket.send(
            PlayPackets.clientbound.set_entity_data.write({
              entity_id: id,
              metadata: Array.from(entity.metadata_raw).map(
                ([index, value]) => ({
                  index,
                  value,
                })
              ),
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
          // if (slot != null) {
          //   console.log(`slot:`, slot);
          //   minecraft_socket.send(
          //     PlayPackets.clientbound.set_equipment.write({
          //       entity_id: id,
          //       equipment: [
          //         {
          //           slot: slot_name,
          //           data: slot_to_packetable(slot)
          //         },
          //       ],
          //     })
          //   );
          // }
        }

        minecraft_socket.send(
          PlayPackets.clientbound.bundle_delimiter_optimised
        );
      }

      //////////////////////////////////////////////////////////
      /// UPDATE
      //////////////////////////////////////////////////////////
      for (let [uuid, [from, to]] of difference.stayed) {
        minecraft_socket.send(
          PlayPackets.clientbound.bundle_delimiter_optimised
        );

        //////////// POSITION
        let rot_changed = to.pitch !== from.pitch || to.yaw !== from.yaw;
        let pos_changed =
          to.position.x !== from.position.x ||
          to.position.y !== from.position.y ||
          to.position.z !== from.position.z;

        let id = emplace(uuid_to_id, uuid, {
          insert: () => entity_id_counter.get_id(),
        });

        let send_delta =
          pos_changed &&
          Math.abs(to.position.x - from.position.x) < 7.999 &&
          Math.abs(to.position.y - from.position.y) < 7.999 &&
          Math.abs(to.position.z - from.position.z) < 7.999;

        if (send_delta) {
          let delta_x = to.position.x * 4096 - from.position.x * 4096;
          let delta_y = to.position.y * 4096 - from.position.y * 4096;
          let delta_z = to.position.z * 4096 - from.position.z * 4096;
          if (rot_changed) {
            minecraft_socket.send(
              PlayPackets.clientbound.move_entity_pos_rot.write({
                entity_id: id,
                delta_x: delta_x,
                delta_y: delta_y,
                delta_z: delta_z,
                on_ground: true,
                pitch: Math.floor(to.pitch ?? 0),
                yaw: Math.floor(to.yaw ?? 0),
              })
            );
          } else {
            minecraft_socket.send(
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
            // minecraft_socket.send(
            //   PlayPackets.clientbound.move_entity_pos.write({
            //     entity_id: id,
            //     delta_x: to.x - from.x,
            //     delta_y: to.y - from.y,
            //     delta_z: to.z - from.z,
            //     on_ground: true,
            //   })
            // );
            minecraft_socket.send(
              PlayPackets.clientbound.teleport_entity.write({
                entity_id: id,
                x: to.position.x,
                y: to.position.y,
                z: to.position.z,
                yaw: Math.floor(to.yaw ?? 0),
                pitch: Math.floor(to.pitch ?? 0),
                on_ground: true,
              })
            );
          }

          if (rot_changed) {
            minecraft_socket.send(
              PlayPackets.clientbound.move_entity_rot.write({
                entity_id: id,
                pitch: Math.floor(to.pitch ?? 0),
                yaw: Math.floor(to.yaw ?? 0),
                on_ground: true,
              })
            );
          }
        }

        if (to.head_yaw !== from.head_yaw) {
          minecraft_socket.send(
            PlayPackets.clientbound.rotate_head.write({
              entity_id: id,
              head_yaw: to.head_yaw ?? 0,
            })
          );
        }

        //////////// METADATA
        let metadata_diff = map_difference(
          from.metadata_raw ?? (new Map() as EntityMetadataMap),
          to.metadata_raw ?? (new Map() as EntityMetadataMap)
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
          minecraft_socket.send(
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
        ).filter(([slot_name, from_slot, to_slot]) => from_slot == to_slot);

        // minecraft_socket.send(
        //   PlayPackets.clientbound.set_equipment.write({
        //     entity_id: id,
        //     equipment: changed_slots.map(([slot_name, from_slot, to_slot]) => ({
        //       slot: slot_name,
        //       data: slot_to_packetable(to_slot),
        //     })),
        //   })
        // );

        minecraft_socket.send(
          PlayPackets.clientbound.bundle_delimiter_optimised
        );
      }
    });

    let on_interact =
      new StoppableHookableEventController<EntityInteractEvent>();

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

        on_interact.run({
          action,
          sneaking,
          entity_uuid: entity_uuid,
        });

        // player.messy_events.emit("interact", {
        //   action,
        //   sneaking,
        //   entity_uuid: entity_uuid,
        // });
      },
      { signal: signal }
    );

    return {
      on_interact: on_interact.listener(),
    };
  };
};
