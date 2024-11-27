import { find_inside_registry_id } from "@2weeks/minecraft-data";
import { registries } from "@2weeks/minecraft-data/registries";
import { EventEmitter } from "node:events";
import { type ChatDriverOutput } from "../Drivers/chat_driver.ts";
import {
  slot_component_protocol,
  type SlotProtocolResult,
} from "../protocol/minecraft-protocol.ts";
import { StoppableHookableEvent } from "../packages/stopable-hookable-event.ts";
import {
  type EntityPosition,
  type Face,
  type Position,
  type Slot,
} from "../PluginInfrastructure/MinecraftTypes.ts";
import { type ValueOfProtocol } from "../protocol/protocol.ts";
import { json_to_nbtish, nbtish_to_json } from "../protocol/nbt-json.ts";
import { type TextComponent } from "../protocol/text-component.ts";
import { type AnySignal } from "../utils/signals.ts";
import { UUID } from "../utils/UUID.ts";
import { MutableSurvivalInventory } from "../play.ts";

export { type Slot };

export let slot_data_to_slot = (slot_data: SlotProtocolResult): Slot | null => {
  if (slot_data.type === 0) {
    return null;
  } else {
    // if (slot_data.type !== 1) {
    //   throw new Error(`Unknown clicked item count: ${slot_data.type}`);
    // }
    if (!slot_data.value) {
      throw new Error("No value");
    }

    let item = slot_data.value;

    let name = find_inside_registry_id(
      // @ts-ignore
      registries["minecraft:item"],
      item.item_id
    ) as any;

    let decode_values = {} as NonNullable<Slot["properties"]>;
    for (let value of item.components.added) {
      if (value.type === "minecraft:lore") {
        decode_values.lore = value.value.map((x) => x);
      } else if (value.type === "minecraft:rarity") {
        decode_values.rarity = value.value;
      } else if (value.type === "minecraft:damage") {
        decode_values.damage = value.value;
      } else if (value.type === "minecraft:max_damage") {
        decode_values.max_damage = value.value;
      } else if (value.type === "minecraft:custom_name") {
        decode_values.custom_name = value.value;
      } else if (value.type === "minecraft:item_name") {
        decode_values.item_name = value.value;
      } else if (value.type === "minecraft:map_id") {
        decode_values.map_id = value.value;
      } else if (value.type === "minecraft:custom_data") {
        decode_values.custom_data = nbtish_to_json({
          type: "compound",
          value: value.value.value as any,
        });
      } else if (value.type === "minecraft:enchantment_glint_override") {
        decode_values.enchantment_glint_override = true;
      } else if (value.type === "minecraft:custom_model_data") {
        decode_values.custom_model_data = value.value;
      } else if (value.type === "minecraft:max_stack_size") {
        decode_values.max_stack_size = value.value;
      } else if (value.type === "minecraft:unbreakable") {
        decode_values.unbreakable = value.value;
      } else if (value.type === "minecraft:profile") {
        decode_values.profile = {
          name: value.value.name ?? undefined,
          uuid:
            value.value.uuid != null ?
              UUID.from_bigint(value.value.uuid).toString()
            : undefined,
          properties: (value.value.properties ?? []).map((x) => ({
            name: x.name,
            value: x.value,
            signature: x.signature ?? undefined,
          })),
        };
      } else {
        // @ts-expect-error
        throw new Error(`Unknown component type: ${value.type}`);
      }
    }

    return {
      item: name,
      count: slot_data.type,
      properties: decode_values,
    };
  }
};

export let slot_to_packetable = (
  slot: Slot | null | undefined
): SlotProtocolResult => {
  if (slot == null || slot.count === 0) {
    return { type: 0, value: undefined };
  }

  type SlotComponentType = ValueOfProtocol<typeof slot_component_protocol>;
  let component = (data: SlotComponentType) => data;

  let components: Array<SlotComponentType> = [
    slot.properties?.lore != null &&
      component({
        type: "minecraft:lore",
        value: slot.properties.lore,
      }),
    slot.properties?.rarity != null &&
      component({
        type: "minecraft:rarity",
        value: slot.properties.rarity,
      }),
    slot.properties?.damage != null &&
      component({
        type: "minecraft:damage",
        value: slot.properties.damage,
      }),
    slot.properties?.max_damage != null &&
      component({
        type: "minecraft:max_damage",
        value: slot.properties.max_damage,
      }),
    slot.properties?.custom_name != null &&
      component({
        type: "minecraft:custom_name",
        value: slot.properties.custom_name,
      }),
    slot.properties?.item_name != null &&
      component({
        type: "minecraft:item_name",
        value: slot.properties.item_name,
      }),
    slot.properties?.map_id != null &&
      component({
        type: "minecraft:map_id",
        value: slot.properties.map_id,
      }),
    slot.properties?.custom_data != null &&
      (() => {
        return component({
          type: "minecraft:custom_data",
          value: json_to_nbtish(slot.properties!.custom_data) as any,
        });
      })(),
    slot.properties?.enchantment_glint_override != null &&
      component({
        type: "minecraft:enchantment_glint_override",
        value: slot.properties?.enchantment_glint_override,
      }),
    slot.properties?.custom_model_data != null &&
      component({
        type: "minecraft:custom_model_data",
        value: slot.properties.custom_model_data,
      }),
    slot.properties?.max_stack_size != null &&
      component({
        type: "minecraft:max_stack_size",
        value: slot.properties.max_stack_size,
      }),
    slot.properties?.unbreakable != null &&
      component({
        type: "minecraft:unbreakable",
        value: slot.properties.unbreakable,
      }),
    slot.properties?.profile != null &&
      component({
        type: "minecraft:profile",
        value: {
          name: slot.properties.profile.name ?? null,
          uuid:
            slot.properties.profile.uuid != null ?
              UUID.from_string(slot.properties.profile.uuid).toBigInt()
            : null,
          properties: (slot.properties.profile.properties ?? []).map((x) => ({
            name: x.name,
            value: x.value,
            signature: x.signature ?? null,
          })),
        },
      }),
  ].filter((x) => x != null && x !== false) as Array<SlotComponentType>;

  return {
    type: slot.count ?? 1,
    value: {
      item_id: registries["minecraft:item"].entries[slot.item].protocol_id,
      components: {
        added: components,
        removed: [],
      },
    },
  };
};

export type Hotbar = [
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
  Slot | null,
];

type MutableSignalLike<T> = {
  get(): T;
  set(value: T): void;
};

export type OnInteractEvent = {
  target:
    | {
        type: "block";
        position: Position;
        face: Face;
        cursor: { x: number; y: number; z: number };
      }
    | {
        type: "entity";
      };
  item: Slot | null;
  type: "interact" | "attack";
};

type BasicPlayerContext = {
  uuid: UUID;
  /** @deprecated ideally don't use this, but sometimes you are just experimenting..  */
  entity_id: number;
  name: string;
  texture: {
    value: string;
    signature: string;
  } | null;

  view_distance$: AnySignal<number>;
  teleport: (position: EntityPosition) => void;
  position$: AnySignal<EntityPosition>;
  chat: ChatDriverOutput;

  on_interact_v1: StoppableHookableEvent<OnInteractEvent>;

  survival_inventory: MutableSurvivalInventory;
};

export class BasicPlayer {
  #context: BasicPlayerContext;
  messy_events: EventEmitter;
  inventory: MutableSurvivalInventory;

  constructor(context: BasicPlayerContext) {
    this.#context = context;
    this.messy_events = new EventEmitter();
    this.inventory = context.survival_inventory;
  }

  on_interact_v1(
    handler: (event: OnInteractEvent) => void,
    options: { signal: AbortSignal }
  ) {
    this.#context.on_interact_v1.on(handler, options);
  }
  on_interact_v1_catch(
    handler: (event: OnInteractEvent) => void,
    options: { signal: AbortSignal }
  ) {
    this.#context.on_interact_v1.end(handler, options);
  }

  get entity_id() {
    return this.#context.entity_id;
  }
  get name() {
    return this.#context.name;
  }
  get texture() {
    return this.#context.texture;
  }
  get uuid() {
    return this.#context.uuid;
  }

  get position(): EntityPosition {
    return this.#context.position$.get();
  }

  teleport(position: EntityPosition | Position) {
    this.#context.teleport({
      yaw: this.position.yaw,
      pitch: this.position.pitch,
      ...position,
    });
  }

  send(message: TextComponent | string) {
    this.#context.chat.send(message);
  }
  statusbar(message: TextComponent | string) {
    this.#context.chat.statusbar(message);
  }

  get view_distance() {
    return this.#context.view_distance$.get();
  }
}
