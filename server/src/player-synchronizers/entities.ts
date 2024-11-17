import { registries } from "@2weeks/minecraft-data";
import { emplace, map_difference } from "../immappable.ts";
import { PlayPackets } from "../minecraft-protocol.ts";
import { type AnySignal, effect } from "../signals.ts";
import { entity_id_counter } from "../Unique.ts";

export type NiceSlotData = {
  item: string;
  count: number;
};

export type Entity = {
  // entity_id: number;
  // entity_uuid: bigint;
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
    main_hand?: NiceSlotData;
    off_hand?: NiceSlotData;
    head?: NiceSlotData;
    chest?: NiceSlotData;
    legs?: NiceSlotData;
    feet?: NiceSlotData;
  };
};

export let entities_synchronizer = ({
  entities$,
  writer,
}: {
  entities$: AnySignal<Map<bigint, Entity>>;
  writer: WritableStreamDefaultWriter;
}) => {
  let uuid_to_id = new Map<bigint, number>();
  let current_entities = new Map<bigint, Entity>();

  effect(() => {
    let expected_entities = entities$.get();

    let difference = map_difference(current_entities, expected_entities);
    current_entities = expected_entities;

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

      writer.write(
        PlayPackets.clientbound.remove_entities.write({
          entities: entity_ids,
        })
      );
    }

    for (let [uuid, entity] of difference.added) {
      let id = emplace(uuid_to_id, uuid, {
        insert: () => entity_id_counter.get_id(),
      });

      let type = registries["minecraft:entity_type"].entries[entity.type];
      if (!type) {
        throw new Error(`Unknown entity type: ${entity.type}`);
      }

      writer.write(
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

      if (entity.equipment?.main_hand) {
        writer.write(
          PlayPackets.clientbound.set_equipment.write({
            entity_id: id,
            equipment: [
              {
                slot: "main_hand",
                data: {
                  type: 1,
                  value: {
                    item_id:
                      registries["minecraft:item"].entries[
                        entity.equipment.main_hand.item
                      ].protocol_id,
                    components: {
                      type: {
                        number_to_add: 0,
                        number_to_remove: 0,
                      },
                      value: {
                        added: [],
                        removed: [],
                      },
                    },
                  },
                },
              },
            ],
          })
        );
      }
    }

    for (let [uuid, [from, to]] of difference.stayed) {
      let rot_changed = to.pitch !== from.pitch || to.yaw !== from.yaw;
      let pos_changed = to.x !== from.x || to.y !== from.y || to.z !== from.z;

      let id = emplace(uuid_to_id, uuid, {
        insert: () => entity_id_counter.get_id(),
      });

      if (pos_changed) {
        throw new Error(`not implemented!`);
      }

      if (rot_changed) {
        writer.write(
          PlayPackets.clientbound.move_entity_rot.write({
            entity_id: id,
            pitch: Math.floor(to.pitch),
            yaw: Math.floor(to.yaw),
            on_ground: true,
          })
        );
      }
      if (to.head_yaw !== from.head_yaw) {
        writer.write(
          PlayPackets.clientbound.rotate_head.write({
            entity_id: id,
            head_yaw: to.head_yaw,
          })
        );
      }
    }
  });
};
