import { registries } from "@2weeks/minecraft-data";
import { slot_component_protocol, SlotProtocol } from "./minecraft-protocol.ts";
import { SingleEventEmitter } from "./packages/single-event-emitter.ts";
import { type ValueOfProtocol } from "./protocol.ts";
import { type TextComponent } from "./protocol/text-component.ts";
import { type AnySignal } from "./signals.ts";
import { UUID } from "./utils/UUID.ts";
import { EventEmitter } from "node:events";

type Position = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};

export type Slot = {
  item: string;
  count: number;

  properties?: {
    rarity?: "common" | "uncommon" | "rare" | "epic";
    lore?: Array<string>;
    max_damage?: number;
    damage?: number;
    item_name?: TextComponent | string;
    custom_name?: TextComponent | string;
    map_id?: number;
  };
  // nbt: string;
};

export let slot_to_packetable = (
  slot: Slot | null | undefined
): ValueOfProtocol<typeof SlotProtocol> => {
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
  ].filter((x) => x != null && x !== false) as Array<SlotComponentType>;

  return {
    type: slot.count,
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

type BasicPlayerContext = {
  uuid: UUID;
  teleport_event: SingleEventEmitter<Position>;
  position$: AnySignal<Position>;
  hotbar$: MutableSignalLike<Hotbar>;
  selected_hotbar_slot$: MutableSignalLike<number>;
  field_of_view_modifier$: MutableSignalLike<number>;
  player_broadcast_stream: SingleEventEmitter<{
    message: TextComponent | string;
  }>;
};

export class BasicPlayer {
  #context: BasicPlayerContext;
  messy_events: EventEmitter;
  constructor(context: BasicPlayerContext) {
    this.#context = context;
    this.messy_events = new EventEmitter();
  }

  get uuid() {
    return this.#context.uuid;
  }

  get position(): Position {
    return this.#context.position$.get();
  }

  teleport(position: Position) {
    this.#context.teleport_event.emit(position);
  }

  send(message: TextComponent | string) {
    this.#context.player_broadcast_stream.emit({ message });
  }

  get selected_hotbar_slot$() {
    return this.#context.selected_hotbar_slot$;
  }
  get hotbar$() {
    return this.#context.hotbar$;
  }

  set fov(value: number) {
    this.#context.field_of_view_modifier$.set(value);
  }
}
