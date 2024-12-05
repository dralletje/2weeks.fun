import { packets, registries } from "@2weeks/minecraft-data";
import { type RegistryResourceKey } from "@2weeks/minecraft-data/registries";
import { mapValues } from "lodash-es";
import { mcp } from "./mcp.ts";
import {
  combined,
  concat,
  native,
  prefilled,
  type Protocol,
  switch_on_type,
  switch_on_type2,
  type ValueOfProtocol,
  wrap,
} from "./protocol.ts";
import { brigadier_node } from "./brigadier.ts";
import { nbt } from "./nbt.ts";

let not_implemented = (name: string) =>
  ({
    encode: (data: any) => {
      throw new Error(`Encode ${name} not implemented`);
    },
    decode: (buffer: Uint8Array) => {
      throw new Error(`Decode ${name} not implemented`);
    },
  }) satisfies Protocol<any>;

let repeat_360_noscope = <T>(protocol: Protocol<T>): Protocol<Array<T>> => {
  return {
    encode: (data) => {
      return concat(data.map((item) => protocol.encode(item)));
    },
    decode: (buffer) => {
      let items: Array<T> = [];
      let offset = 0;

      while (offset < buffer.length) {
        let prev_offset = offset;
        try {
          let [item, length] = protocol.decode(buffer.subarray(offset));
          items.push(item);
          offset += length;
        } catch (e) {
          console.log(`offset:`, offset);
          console.log(`buffer.length:`, buffer.length);
          console.log(`buffer:`, buffer.subarray(offset));
          console.log(`e:`, e);
          throw e;
        }
      }

      return [items, offset];
    },
  };
};

// let LongArray = native.repeated(mcp.varint, mcp.Long);
/// Optimised
// let LongArray = {
//   encode: (values: Array<bigint>) => {
//     let count = mcp.varint.encode(values.length);
//     let buffer = new ArrayBuffer(values.length * 8);
//     let dataview = new DataView(buffer);
//     for (let i = 0; i < values.length; i++) {
//       dataview.setBigInt64(i * 8, values[i]);
//     }
//     return concat([count, new Uint8Array(buffer)]);
//   },
//   decode: (buffer: Uint8Array) => {
//     return native.repeated(mcp.varint, mcp.Long).decode(buffer);
//   },
// } satisfies Protocol<Array<bigint>>;

// let LongArray = {
//   encode: (values: Array<bigint>) => {
//     let count = mcp.varint.encode(values.length);
//     let buffer = new ArrayBuffer(values.length * 8);
//     let dataview = new DataView(buffer);
//     for (let i = 0; i < values.length; i++) {
//       dataview.setBigInt64(i * 8, values[i]);
//     }
//     return concat([count, new Uint8Array(buffer)]);
//   },
//   decode: (buffer: Uint8Array) => {
//     return native.repeated(mcp.varint, mcp.Long).decode(buffer);
//   },
// } satisfies Protocol<Array<bigint>>;

let LongArray = native.with_byte_length(
  wrap({
    protocol: mcp.varint,
    encode: (x) => Math.ceil(x / 8),
    decode: (x) => x * 8,
  }),
  {
    encode: (values: Array<bigint>) => {
      let buffer = new ArrayBuffer(values.length * 8);
      let dataview = new DataView(buffer);
      for (let i = 0; i < values.length; i++) {
        dataview.setBigInt64(i * 8, values[i]);
      }
      return new Uint8Array(buffer);
    },
    decode: (buffer: Uint8Array) => {
      let longs = new BigInt64Array(buffer.buffer);
      return [Array.from(longs), buffer.length];
      // return native.repeated(mcp.varint, mcp.Long).decode(buffer);
    },
  } satisfies Protocol<Array<bigint>>
);

let LongArrayAsUint8Array = native.with_byte_length(
  wrap({
    protocol: mcp.varint,
    encode: (x) => Math.ceil(x / 8),
    decode: (x) => x * 8,
  }),
  native.uint8array
);

let dynamic_enum = <Enum, Output extends Protocol<any>>(
  enum_protocol: Protocol<Enum>,
  caser: (x: Enum) => Output
): Protocol<{ type: Enum; value: ValueOfProtocol<Output> }> => {
  return {
    encode: (data) => {
      let encoded_value = caser(data.type).encode(data.value);
      return concat([enum_protocol.encode(data.type), encoded_value]);
    },
    decode: (buffer) => {
      let [type, length] = enum_protocol.decode(buffer);
      let [value, value_length] = caser(type).decode(buffer.subarray(length));
      return [{ type, value }, length + value_length];
    },
  };
};

let repeated_x = <T>(
  count: number,
  protocol: Protocol<T>
): Protocol<Array<T>> => {
  return {
    encode: (data) => {
      return concat(data.map((item) => protocol.encode(item)));
    },
    decode: (buffer) => {
      let items: Array<T> = [];
      let offset = 0;
      for (let i = 0; i < count; i++) {
        let [item, length] = protocol.decode(buffer.subarray(offset));
        items.push(item);
        offset += length;
      }
      return [items, offset];
    },
  };
};

let game_mode_varint = mcp.enum(mcp.varint, [
  "survival",
  "creative",
  "adventure",
  "spectator",
]);

type SwitchOnType2Helper<T extends { [key: string]: Protocol<any> }> = {
  [Key in keyof T]: {
    type: any;
    value: T[Key];
  };
};

let slot_component_registry =
  registries["minecraft:data_component_type"].entries;
let slot_components = {
  "minecraft:custom_data": nbt.compound.network,
  "minecraft:max_stack_size": mcp.varint,
  "minecraft:max_damage": mcp.varint,
  "minecraft:damage": mcp.varint,
  "minecraft:unbreakable": mcp.boolean,
  "minecraft:custom_name": mcp.text_component,
  "minecraft:item_name": mcp.text_component,
  "minecraft:lore": mcp.list(mcp.text_component),
  "minecraft:rarity": mcp.enum(mcp.varint, [
    "common",
    "uncommon",
    "rare",
    "epic",
  ]),
  "minecraft:map_id": mcp.varint,
  "minecraft:enchantment_glint_override": mcp.boolean,
  "minecraft:custom_model_data": mcp.varint,
  "minecraft:profile": combined([
    { name: "name", protocol: mcp.optional(mcp.string_with_maxlength(16)) },
    { name: "uuid", protocol: mcp.optional(mcp.UUID) },
    {
      name: "properties",
      protocol: mcp.list(
        combined([
          { name: "name", protocol: mcp.string_with_maxlength(64) },
          { name: "value", protocol: mcp.string },
          {
            name: "signature",
            protocol: mcp.optional(mcp.string_with_maxlength(1024)),
          },
        ])
      ),
    },
  ]),
} satisfies Partial<{
  [key in RegistryResourceKey<"minecraft:data_component_type">]: Protocol<any>;
}>;

export let slot_component_protocol = switch_on_type2(
  mcp.varint,
  mapValues(slot_component_registry, (protocol, name) => {
    return {
      type: protocol.protocol_id,
      value: slot_components[name] ?? not_implemented(`slot component ${name}`),
    };
  }) as SwitchOnType2Helper<typeof slot_components>
);

let registry_enum = <Key extends string, T>(
  protocol: Protocol<T>,
  registry: Record<Key, { protocol_id: T }>
): Protocol<Key> => {
  let protocol_id_to_name = new Map<T, Key>();
  // @ts-ignore
  for (let [name, { protocol_id }] of Object.entries(registry)) {
    // @ts-ignore
    protocol_id_to_name.set(protocol_id, name);
  }

  return {
    encode: (value: Key) => {
      let resource = registry[value];
      if (resource == null) {
        throw new Error(`Invalid enum name: ${value}`);
      }
      return protocol.encode(resource.protocol_id);
    },
    decode: (buffer: Uint8Array) => {
      let [value, offset] = protocol.decode(buffer);
      let name = protocol_id_to_name.get(value);
      if (name == null) {
        throw new Error(`Invalid enum value: ${value}`);
      }
      return [name, offset];
    },
  };
};

// let data_components_enum = mcp.enum(mcp.varint, [
//   "minecraft:custom_data",
//   "minecraft:max_stack_size",
//   "minecraft:max_damage",
//   "minecraft:damage",
//   "minecraft:unbreakable",
//   "minecraft:custom_name",
//   "minecraft:item_name",
//   "minecraft:lore",
//   "minecraft:rarity",
// ]);

let data_components_enum = registry_enum(mcp.varint, slot_component_registry);

export let SlotProtocol = dynamic_enum(mcp.varint, (item_count) => {
  if (item_count === 0) {
    return native.empty;
  } else {
    return combined([
      { name: "item_id", protocol: mcp.varint },
      {
        name: "components",
        protocol: wrap({
          protocol: dynamic_enum(
            combined([
              { name: "number_to_add", protocol: mcp.varint },
              { name: "number_to_remove", protocol: mcp.varint },
            ]),
            (x) => {
              return combined([
                {
                  name: "added",
                  protocol: repeated_x(
                    x.number_to_add,
                    slot_component_protocol
                  ),
                },
                {
                  name: "removed",
                  protocol: repeated_x(
                    x.number_to_remove,
                    data_components_enum
                  ),
                },
              ]);
            }
          ),
          encode: (data: {
            added: Array<ValueOfProtocol<typeof slot_component_protocol>>;
            removed: Array<ValueOfProtocol<typeof data_components_enum>>;
          }) => {
            return {
              type: {
                number_to_add: data.added.length,
                number_to_remove: data.removed.length,
              },
              value: { added: data.added, removed: data.removed },
            };
          },
          decode: (buffer) => {
            return { added: buffer.value.added, removed: buffer.value.removed };
          },
        }),
      },
    ]);
  }
});

export type SlotProtocolResult = ValueOfProtocol<typeof SlotProtocol>;

let but_as_uint8array = (protocol: Protocol<any>): Protocol<Uint8Array> => {
  return {
    encode: (data) => {
      return data;
    },
    decode: (buffer) => {
      let [_, length] = protocol.decode(buffer);
      return [buffer.subarray(0, length), length];
    },
  };
};

export let HandshakePackets = {
  serverbound: {
    intention: mcp.Packet(
      packets.handshake.serverbound["minecraft:intention"].protocol_id,
      [
        { name: "protocol_version", protocol: mcp.varint },
        { name: "host", protocol: mcp.string },
        { name: "port", protocol: mcp.UnsignedShort },
        {
          name: "next_state",
          protocol: mcp.enum(
            /// Because the next_state enum goes from 1,2,3 , but the protocol assumes from 0,1,2
            wrap({
              protocol: mcp.varint,
              encode: (x) => x + 1,
              decode: (x) => x - 1,
            }),
            ["status", "login", "transfer"]
          ),
        },
      ]
    ),
  },
};

export let StatusPackets = {
  serverbound: {
    status_request: mcp.Packet(
      packets.status.serverbound["minecraft:status_request"].protocol_id,
      []
    ),
    ping_request: mcp.Packet(
      packets.status.serverbound["minecraft:ping_request"].protocol_id,
      [{ name: "timestamp", protocol: mcp.Long }]
    ),
  },
  clientbound: {
    status_response: mcp.Packet(
      packets.status.clientbound["minecraft:status_response"].protocol_id,
      [
        {
          name: "response",
          protocol: mcp.json_weakly_typed<{
            version: { name: string; protocol: number };
            players: {
              max: number;
              online: number;
              sample?: Array<{ id: string; name: string }>;
            };
            description: string;
            favicon?: string;
          }>(),
        },
      ]
    ),
    pong_response: mcp.Packet(
      packets.status.clientbound["minecraft:pong_response"].protocol_id,
      [{ name: "timestamp", protocol: mcp.Long }]
    ),
  },
};

export let LoginPackets = {
  serverbound: {
    hello: mcp.Packet(
      packets.login.serverbound["minecraft:hello"].protocol_id,
      [
        { name: "name", protocol: mcp.string },
        { name: "uuid", protocol: mcp.UUID },
      ]
    ),
    login_acknowledged: mcp.Packet(
      packets.login.serverbound["minecraft:login_acknowledged"].protocol_id,
      []
    ),
  },
  clientbound: {
    game_profile: mcp.Packet(
      packets.login.clientbound["minecraft:game_profile"].protocol_id,
      [
        { name: "uuid", protocol: mcp.UUID },
        { name: "name", protocol: mcp.string },
        {
          name: "properties",
          protocol: mcp.list(
            combined([
              { name: "name", protocol: mcp.string },
              { name: "value", protocol: mcp.string },
              { name: "signature", protocol: mcp.optional(mcp.string) },
            ])
          ),
        },
        { protocol: prefilled(mcp.UnsignedByte, 1) },
      ]
    ),
  },
};

export let ConfigurationPackets = {
  serverbound: {
    finish_configuration: mcp.Packet(
      packets.configuration.serverbound["minecraft:finish_configuration"]
        .protocol_id,
      []
    ),
    select_known_packs: mcp.Packet(
      packets.configuration.serverbound["minecraft:select_known_packs"]
        .protocol_id,
      [
        {
          name: "packs",
          protocol: mcp.list(
            combined([
              { name: "namespace", protocol: mcp.string },
              { name: "id", protocol: mcp.string },
              { name: "version", protocol: mcp.string },
            ])
          ),
        },
      ]
    ),
    custom_payload: mcp.Packet(
      packets.configuration.serverbound["minecraft:custom_payload"].protocol_id,
      [
        { name: "channel", protocol: mcp.string },
        { name: "data", protocol: native.uint8array },
      ]
    ),
    client_information: mcp.Packet(
      packets.configuration.serverbound["minecraft:client_information"]
        .protocol_id,
      [
        { name: "locale", protocol: mcp.string },
        { name: "view_distance", protocol: mcp.UnsignedByte },
        {
          name: "chat_mode",
          protocol: mcp.enum(mcp.varint, [
            "enabled",
            "commands only",
            "hidden",
          ]),
        },
        { name: "chat_colors", protocol: mcp.boolean },
        {
          name: "skin_parts",
          protocol: mcp.bitmask([
            "cape",
            "jacket",
            "left_sleeve",
            "right_sleeve",
            "left_pants_left",
            "right_pants_leg",
            "hat",
          ]),
        },
        {
          name: "main_hand",
          protocol: mcp.enum(mcp.varint, ["left", "right"]),
        },
        { name: "enable_text_filtering", protocol: mcp.boolean },
        { name: "allow_server_listing", protocol: mcp.boolean },
      ]
    ),
  },
  clientbound: {
    select_known_packs: mcp.Packet(
      packets.configuration.clientbound["minecraft:select_known_packs"]
        .protocol_id,
      [
        {
          name: "packs",
          protocol: mcp.list(
            combined([
              { name: "namespace", protocol: mcp.string },
              { name: "id", protocol: mcp.string },
              { name: "version", protocol: mcp.string },
            ])
          ),
        },
      ]
    ),
    transfer: mcp.Packet(
      packets.configuration.clientbound["minecraft:transfer"].protocol_id,
      [
        { name: "host", protocol: mcp.string },
        { name: "port", protocol: mcp.varint },
      ]
    ),
    finish_configuration: mcp.Packet(
      packets.configuration.clientbound["minecraft:finish_configuration"]
        .protocol_id,
      []
    ),
    registry_data: mcp.Packet(
      packets.configuration.clientbound["minecraft:registry_data"].protocol_id,
      [
        { name: "registry_id", protocol: mcp.string },
        // { name: "entries", protocol: native.uint8array },
        {
          name: "entries",
          protocol: mcp.list(
            combined([
              { name: "identifier", protocol: mcp.string },
              { name: "data", protocol: mcp.optional(nbt.any.network) },
              // { name: "Hmmm", protocol: native.uint8array },
            ])
          ),
        },
        // { name: "entries", protocol: mcp.varint },
        // { name: "identifier", protocol: mcp.string },
        // { name: "data", protocol: mcp.optional(nbt.any.standalone) },

        // { name: "identifier2", protocol: mcp.string },
        // { name: "data2", protocol: mcp.optional(nbt.any.standalone) },

        // { name: "identifier3", protocol: mcp.string },
        // { name: "data3", protocol: mcp.optional(nbt.any.standalone) },

        // { name: "identifier4", protocol: mcp.string },
        // { name: "data4", protocol: mcp.optional(nbt.any.standalone) },

        // { name: "identifier5", protocol: mcp.string },
        // { name: "_", protocol: mcp.boolean },
        // // { name: "data5", protocol: mcp.optional(nbt.any.standalone) },

        // { name: "Hmmm", protocol: native.uint8array },
      ]
    ),
    server_links: mcp.Packet(
      packets.configuration.clientbound["minecraft:server_links"].protocol_id,
      [
        {
          name: "links",
          protocol: mcp.list(
            combined([
              {
                name: "label",
                protocol: mcp.either(
                  mcp.enum(mcp.varint, [
                    "Bug Report",
                    "Community Guidelines",
                    "Support",
                    "Status",
                    "Feedback",
                    "Community",
                    "Website",
                    "Forums",
                    "News",
                    "Announcements",
                  ]),
                  mcp.text_component
                ),
              },
              {
                name: "url",
                protocol: mcp.string,
              },
            ])
          ),
        },
      ]
    ),
  },
};

let entity_metadata_value = switch_on_type2(mcp.UnsignedByte, {
  byte: {
    type: 0,
    value: mcp.Byte,
  },
  varint: {
    type: 1,
    value: mcp.varint,
  },
  varlong: {
    type: 2,
    value: not_implemented("varlong"),
  },
  float: {
    type: 3,
    value: mcp.Float,
  },
  string: {
    type: 4,
    value: mcp.string,
  },
  chat: {
    type: 5,
    value: mcp.text_component,
  },
  optional_chat: {
    type: 6,
    value: mcp.optional(mcp.text_component),
  },
  slot: {
    type: 7,
    value: SlotProtocol,
  },
  boolean: {
    type: 8,
    value: mcp.boolean,
  },
  block_state: {
    type: 14,
    value: mcp.varint,
  },
  optional_block_state: {
    type: 15,
    value: mcp.optional(mcp.varint),
  },
  pose: {
    type: 21,
    value: mcp.enum(mcp.varint, [
      "standing",
      "falling",
      "sleeping",
      "swimming",
      "spinning",
      "sneaking",
      "long_jumping",
      "dying",
      "croaking",
      "using_tongue",
      "sitting",
      "roaring",
      "sniffing",
      "emerging",
      "digging",
      // "sliding",
      // "shooting",
      // "inhaling"
    ]),
  },
  vector3: {
    type: 29,
    value: combined([
      { name: "x", protocol: mcp.Float },
      { name: "y", protocol: mcp.Float },
      { name: "z", protocol: mcp.Float },
    ]),
  },
});

export type EntityMetadataEntry = {
  index: number;
  value: ValueOfProtocol<typeof entity_metadata_value>;
};
let entity_metadata_protocol = {
  encode: (data) => {
    return concat([
      ...data.map((entry) => {
        let value = entity_metadata_value.encode(entry.value);
        return concat([mcp.Byte.encode(entry.index), value]);
      }),
      mcp.Byte.encode(0xff),
    ]);
  },
  decode: (buffer: Uint8Array) => {
    let results: Array<EntityMetadataEntry> = [];
    let offset = 0;

    while (true) {
      if (buffer.length < offset + 1) {
        throw new Error("Entity Metadata ended too soon (without 0xFF");
      }
      let index = buffer[offset];
      if (index === 0xff) {
        return [results, offset + 1];
      }
      let [value, value_offset] = entity_metadata_value.decode(
        buffer.subarray(offset + 1)
      );
      results.push({ index, value });
      offset += value_offset + 1;
    }
  },
} satisfies Protocol<Array<EntityMetadataEntry>>;

export let bossbar_color = mcp.enum(mcp.varint, [
  "pink",
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "white",
]);
export let bossbar_notches = mcp.enum(mcp.varint, [
  "none",
  "6 notches",
  "10 notches",
  "12 notches",
  "20 notches",
]);
export let bossbar_flags = mcp.bitmask([
  "darken_sky",
  "play_music",
  "create_fog",
]);

let faces = mcp.enum(mcp.varint, [
  "bottom",
  "top",
  "north",
  "south",
  "west",
  "east",
]);

let slot_enum = mcp.enum(mcp.Byte, [
  "main_hand",
  "off_hand",
  "boots",
  "leggings",
  "chestplate",
  "helmet",
  "body",
]);

export let PlayPackets = {
  serverbound: {
    container_click: mcp.Packet(
      packets.play.serverbound["minecraft:container_click"].protocol_id,
      [
        { name: "window_id", protocol: mcp.UnsignedByte },
        { name: "state_id", protocol: mcp.varint },
        { name: "slot", protocol: mcp.Short },
        { name: "button", protocol: mcp.Byte },
        { name: "mode", protocol: mcp.varint },
        {
          name: "changed_slots",
          protocol: mcp.list(
            combined([
              { name: "slot", protocol: mcp.Short },
              { name: "item", protocol: SlotProtocol },
            ])
          ),
        },
        { name: "carried", protocol: SlotProtocol },
      ]
    ),
    rename_item: mcp.Packet(
      packets.play.serverbound["minecraft:rename_item"].protocol_id,
      [{ name: "item_name", protocol: mcp.string }]
    ),

    accept_teleportation: mcp.Packet(
      packets.play.serverbound["minecraft:accept_teleportation"].protocol_id,
      [{ name: "teleport_id", protocol: mcp.varint }]
    ),

    command_suggestions: mcp.Packet(
      packets.play.serverbound["minecraft:command_suggestion"].protocol_id,
      [
        { name: "id", protocol: mcp.varint },
        { name: "text", protocol: mcp.string },
      ]
    ),
    chat_command: mcp.Packet(
      packets.play.serverbound["minecraft:chat_command"].protocol_id,
      [{ name: "command", protocol: mcp.string }]
    ),
    chat_command_signed: mcp.Packet(
      packets.play.serverbound["minecraft:chat_command_signed"].protocol_id,
      [
        { name: "command", protocol: mcp.string },
        { name: "timestamp", protocol: mcp.Long },
        { name: "salt", protocol: mcp.Long },
        {
          name: "argument_signatures",
          protocol: mcp.list(
            combined([
              { name: "name", protocol: mcp.string },
              { name: "signature", protocol: native.bytes(256) },
            ])
          ),
        },
        { name: "message_count", protocol: mcp.varint },
        {
          name: "acknowledged_messages",
          protocol: native.bytes(Math.ceil(20 / 8)),
        },
      ]
    ),
    chat: mcp.Packet(packets.play.serverbound["minecraft:chat"].protocol_id, [
      { name: "message", protocol: mcp.string },
      { name: "timestamp", protocol: mcp.Long },
      { name: "salt", protocol: mcp.Long },
      { name: "signature", protocol: mcp.optional(native.bytes(256)) },
      { name: "message_count", protocol: mcp.varint },
      {
        name: "acknowledged_messages",
        protocol: native.bytes(Math.ceil(20 / 8)),
      },
    ]),
    keep_alive: mcp.Packet(
      packets.play.serverbound["minecraft:keep_alive"].protocol_id,
      [{ name: "id", protocol: mcp.Long }]
    ),

    set_create_mode_slot: mcp.Packet(
      packets.play.serverbound["minecraft:set_creative_mode_slot"].protocol_id,
      [
        { name: "slot", protocol: mcp.Short },
        { name: "clicked_item", protocol: SlotProtocol },
        // { name: "clicked_item", protocol: FilledSlot },
      ]
    ),

    interact: mcp.Packet(
      packets.play.serverbound["minecraft:interact"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        // { name: "action", protocol: mcp.varint },
        {
          name: "action",
          protocol: switch_on_type2(mcp.varint, {
            interact: {
              type: 0,
              value: combined([
                {
                  name: "hand",
                  protocol: mcp.enum(mcp.varint, ["main_hand", "off_hand"]),
                },
              ]),
            },
            attack: {
              type: 1,
              value: native.empty,
            },
            interact_at: {
              type: 2,
              value: combined([
                { name: "x", protocol: mcp.Float },
                { name: "y", protocol: mcp.Float },
                { name: "z", protocol: mcp.Float },
                {
                  name: "hand",
                  protocol: mcp.enum(mcp.varint, ["main_hand", "off_hand"]),
                },
              ]),
            },
          }),
        },
        { name: "sneaking", protocol: mcp.boolean },
      ]
    ),
    use_item_on: mcp.Packet(
      packets.play.serverbound["minecraft:use_item_on"].protocol_id,
      [
        {
          name: "hand",
          protocol: mcp.enum(mcp.varint, ["main_hand", "off_hand"]),
        },
        { name: "location", protocol: mcp.Position },
        {
          name: "face",
          protocol: faces,
        },
        {
          name: "cursor",
          protocol: combined([
            { name: "x", protocol: mcp.Float },
            { name: "y", protocol: mcp.Float },
            { name: "z", protocol: mcp.Float },
          ]),
        },
        { name: "inside_block", protocol: mcp.boolean },
        { name: "sequence", protocol: mcp.varint },
      ]
    ),
    player_action: mcp.Packet(
      packets.play.serverbound["minecraft:player_action"].protocol_id,
      [
        {
          name: "action",
          protocol: mcp.enum(mcp.varint, [
            "start_digging",
            "cancel_digging",
            "finish_digging",
            "drop_item_stack",
            "drop_item",
            "using_item",
            "swap_item",
          ]),
        },
        { name: "location", protocol: mcp.Position },
        { name: "face", protocol: faces },
        { name: "sequence", protocol: mcp.varint },
      ]
    ),
    resource_pack_response: mcp.Packet(
      packets.play.serverbound["minecraft:resource_pack"].protocol_id,
      [
        { name: "uuid", protocol: mcp.UUID },
        {
          name: "status",
          protocol: mcp.enum(mcp.varint, [
            "success",
            "declined",
            "failed_download",
            "accepted",
            "downloaded",
            "invalid_url",
            "failed_reload",
            "discarded",
          ]),
        },
      ]
    ),

    player_command: mcp.Packet(
      packets.play.serverbound["minecraft:player_command"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        {
          name: "command",
          protocol: mcp.enum(mcp.varint, [
            "start_sneaking",
            "stop_sneaking",
            "leave_bed",
            "start_sprinting",
            "stop_sprinting",
            "start_horse_jump",
            "stop_horse_jump",
            "open_horse_inventory",
            "start_flying_with_elytra",
          ]),
        },
        { name: "jump_boost", protocol: mcp.varint },
      ]
    ),
    swing: mcp.Packet(packets.play.serverbound["minecraft:swing"].protocol_id, [
      {
        name: "hand",
        protocol: mcp.enum(mcp.varint, ["main_hand", "off_hand"]),
      },
    ]),

    custom_payload: mcp.Packet(
      packets.play.serverbound["minecraft:custom_payload"].protocol_id,
      [
        { name: "channel", protocol: mcp.string },
        { name: "data", protocol: native.uint8array },
      ]
    ),

    set_carried_item: mcp.Packet(
      packets.play.serverbound["minecraft:set_carried_item"].protocol_id,
      [{ name: "slot", protocol: mcp.Short }]
    ),
    container_close: mcp.Packet(
      packets.play.serverbound["minecraft:container_close"].protocol_id,
      [{ name: "container_id", protocol: mcp.UnsignedByte }]
    ),

    move_player_pos: mcp.Packet(
      packets.play.serverbound["minecraft:move_player_pos"].protocol_id,
      [
        { name: "x", protocol: mcp.Double },
        { name: "y", protocol: mcp.Double },
        { name: "z", protocol: mcp.Double },
        { name: "ground", protocol: mcp.boolean },
      ]
    ),
    move_player_pos_rot: mcp.Packet(
      packets.play.serverbound["minecraft:move_player_pos_rot"].protocol_id,
      [
        { name: "x", protocol: mcp.Double },
        { name: "feet_y", protocol: mcp.Double },
        { name: "z", protocol: mcp.Double },
        { name: "yaw", protocol: mcp.Float },
        { name: "pitch", protocol: mcp.Float },
        { name: "ground", protocol: mcp.boolean },
      ]
    ),
    move_player_rot: mcp.Packet(
      packets.play.serverbound["minecraft:move_player_rot"].protocol_id,
      [
        { name: "yaw", protocol: mcp.Float },
        { name: "pitch", protocol: mcp.Float },
        { name: "ground", protocol: mcp.boolean },
      ]
    ),
    move_player_status_only: mcp.Packet(
      packets.play.serverbound["minecraft:move_player_status_only"].protocol_id,
      [{ name: "on_ground", protocol: mcp.boolean }]
    ),
    player_abilities: mcp.Packet(
      packets.play.serverbound["minecraft:player_abilities"].protocol_id,
      [
        {
          name: "flags",
          /// TODO Only flying can be set though..
          protocol: mcp.bitmask([
            "invulnerable",
            "flying",
            "allow_flying",
            "creative_mode",
          ]),
        },
      ]
    ),

    update_sign: mcp.Packet(
      packets.play.serverbound["minecraft:sign_update"].protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "is_front_text", protocol: mcp.boolean },
        { name: "line1", protocol: mcp.string },
        { name: "line2", protocol: mcp.string },
        { name: "line3", protocol: mcp.string },
        { name: "line4", protocol: mcp.string },
      ]
    ),

    client_information: mcp.Packet(
      packets.play.serverbound["minecraft:client_information"].protocol_id,
      [
        { name: "locale", protocol: mcp.string },
        { name: "view_distance", protocol: mcp.UnsignedByte },
        {
          name: "chat_mode",
          protocol: mcp.enum(mcp.varint, [
            "enabled",
            "commands only",
            "hidden",
          ]),
        },
        { name: "chat_colors", protocol: mcp.boolean },
        {
          name: "skin_parts",
          protocol: mcp.bitmask([
            "cape",
            "jacket",
            "left_sleeve",
            "right_sleeve",
            "left_pants_left",
            "right_pants_leg",
            "hat",
          ]),
        },
        {
          name: "main_hand",
          protocol: mcp.enum(mcp.varint, ["left", "right"]),
        },
        { name: "enable_text_filtering", protocol: mcp.boolean },
        { name: "allow_server_listing", protocol: mcp.boolean },
      ]
    ),
  },

  clientbound: {
    // level_particles: mcp.Packet(
    //   packets.play.clientbound["minecraft:level_particles"].protocol_id,
    //   [
    //     { name: "long_distance", protocol: mcp.boolean },
    //     { name: "position", protocol: combined([
    //       { name: "x", protocol: mcp.Double },
    //       { name: "y", protocol: mcp.Double },
    //       { name: "z", protocol: mcp.Double },
    //     ]) },
    //     { name: "offset", protocol: combined([
    //       { name: "x", protocol: mcp.Float },
    //       { name: "y", protocol: mcp.Float },
    //       { name: "z", protocol: mcp.Float },
    //     ]) },
    //     { name: "max_speed", protocol: mcp.Float },
    //     { name: "count", protocol: mcp.varint },
    //     { name: "particle_data", protocol: mcp.Float },
    //   ]
    // ),
    hurt_animation: mcp.Packet(
      packets.play.clientbound["minecraft:hurt_animation"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "yaw", protocol: mcp.Float },
      ]
    ),
    set_experience: mcp.Packet(
      packets.play.clientbound["minecraft:set_experience"].protocol_id,
      [
        { name: "experience_bar", protocol: mcp.Float },
        { name: "level", protocol: mcp.varint },
        { name: "total_experience", protocol: mcp.varint },
      ]
    ),
    entity_event: mcp.Packet(
      packets.play.clientbound["minecraft:entity_event"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.Int },
        { name: "event", protocol: mcp.Byte },
      ]
    ),
    set_health: mcp.Packet(
      packets.play.clientbound["minecraft:set_health"].protocol_id,
      [
        { name: "health", protocol: mcp.Float },
        { name: "food", protocol: mcp.varint },
        { name: "saturation", protocol: mcp.Float },
      ]
    ),
    server_links: mcp.Packet(
      packets.play.clientbound["minecraft:server_links"].protocol_id,
      [
        {
          name: "links",
          protocol: mcp.list(
            combined([
              {
                name: "label",
                protocol: mcp.either(
                  mcp.enum(mcp.varint, [
                    "Bug Report",
                    "Community Guidelines",
                    "Support",
                    "Status",
                    "Feedback",
                    "Community",
                    "Website",
                    "Forums",
                    "News",
                    "Announcements",
                  ]),
                  mcp.text_component
                ),
              },
              {
                name: "url",
                protocol: mcp.string,
              },
            ])
          ),
        },
      ]
    ),
    bundle_delimiter: mcp.Packet(
      packets.play.clientbound["minecraft:bundle_delimiter"].protocol_id,
      []
    ),
    /// Optimised version of the above
    bundle_delimiter_optimised: mcp
      .Packet(
        packets.play.clientbound["minecraft:bundle_delimiter"].protocol_id,
        []
      )
      .write({}),

    commands: mcp.Packet(
      packets.play.clientbound["minecraft:commands"].protocol_id,
      [
        {
          name: "nodes",
          protocol: mcp.list({
            encode: (node: any) => brigadier_node.write(node),
            decode: (buffer) => {
              throw new Error("Not implemented");
            },
          }),
        },
        {
          name: "root_index",
          protocol: mcp.varint,
        },
      ]
    ),
    open_screen: mcp.Packet(
      packets.play.clientbound["minecraft:open_screen"].protocol_id,
      [
        { name: "window_id", protocol: mcp.varint },
        { name: "screen", protocol: mcp.varint },
        { name: "title", protocol: mcp.text_component },
      ]
    ),
    tab_list: mcp.Packet(
      packets.play.clientbound["minecraft:tab_list"].protocol_id,
      [
        { name: "header", protocol: mcp.text_component },
        { name: "footer", protocol: mcp.text_component },
      ]
    ),
    command_suggestions: mcp.Packet(
      packets.play.clientbound["minecraft:command_suggestions"].protocol_id,
      [
        { name: "id", protocol: mcp.varint },
        { name: "start", protocol: mcp.varint },
        { name: "length", protocol: mcp.varint },
        {
          name: "matches",
          protocol: mcp.list(
            combined([
              { name: "text", protocol: mcp.string },
              { name: "tooltip", protocol: mcp.optional(mcp.text_component) },
            ])
          ),
        },
      ]
    ),
    system_chat: mcp.Packet(
      packets.play.clientbound["minecraft:system_chat"].protocol_id,
      [
        {
          name: "message",
          protocol: native.limited_size(262144, mcp.text_component),
        },
        {
          name: "is_action_bar",
          protocol: mcp.boolean,
        },
      ]
    ),
    player_chat: mcp.Packet(
      packets.play.clientbound["minecraft:player_chat"].protocol_id,
      [
        {
          name: "header",
          protocol: combined([
            { name: "sender", protocol: mcp.UUID },
            { name: "index", protocol: mcp.varint },
            { name: "signature", protocol: mcp.optional(native.bytes(256)) },
          ]),
        },

        {
          name: "body",
          protocol: combined([
            { name: "message", protocol: mcp.string },
            { name: "timestamp", protocol: mcp.Long },
            { name: "salt", protocol: mcp.Long },
          ]),
        },

        {
          name: "previous_messages",
          protocol: mcp.list(
            combined([
              { name: "id", protocol: mcp.varint },
              { name: "signature", protocol: native.bytes(256) },
            ])
          ),
        },

        {
          name: "other",
          protocol: combined([
            { name: "content", protocol: mcp.optional(mcp.text_component) },
            /// TODO For completeness could do the filter stuff as well (switch_on_type)
            { protocol: prefilled(mcp.varint, 0) },
          ]),
        },

        {
          name: "formatting",
          protocol: combined([
            { name: "chat_type", protocol: mcp.varint },
            { name: "sender_name", protocol: mcp.text_component },
            { name: "target_name", protocol: mcp.optional(mcp.text_component) },
          ]),
        },
      ]
    ),

    open_sign_editor: mcp.Packet(
      packets.play.clientbound["minecraft:open_sign_editor"].protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "is_front_text", protocol: mcp.boolean },
      ]
    ),

    // set_score: mcp.Packet(
    //   packets.play.clientbound["minecraft:set_score"].protocol_id,
    //   [
    //     { name: "score_name", protocol: mcp.string },
    //     { name: "action", protocol: mcp.varint },
    //     { name: "entries", protocol: mcp.list(mcp.compound) },
    //   ]
    // ),

    set_display_objective: mcp.Packet(
      packets.play.clientbound["minecraft:set_display_objective"].protocol_id,
      [
        {
          name: "position",
          protocol: mcp.enum(mcp.varint, ["list", "sidebar", "below_name"]),
        },
        { name: "objective_name", protocol: mcp.string },
      ]
    ),
    set_score: mcp.Packet(
      packets.play.clientbound["minecraft:set_score"].protocol_id,
      [
        { name: "entity_name", protocol: mcp.string },
        { name: "objective_name", protocol: mcp.string },
        { name: "value", protocol: mcp.varint },
        { name: "title", protocol: mcp.optional(mcp.text_component) },
        { name: "format", protocol: prefilled(mcp.boolean, false) },
      ]
    ),

    set_objective: mcp.Packet(
      packets.play.clientbound["minecraft:set_objective"].protocol_id,
      [
        { name: "objective_name", protocol: mcp.string },
        {
          name: "action",
          protocol: switch_on_type2(mcp.Byte, {
            create: {
              type: 0,
              value: combined([
                { name: "objective_value", protocol: mcp.text_component },
                {
                  name: "type",
                  protocol: mcp.enum(mcp.varint, ["integer", "hearts"]),
                },
                {
                  name: "format",
                  protocol: mcp.optional(
                    switch_on_type2(mcp.varint, {
                      blank: {
                        type: 0,
                        value: native.empty,
                      },
                      styled: {
                        type: 1,
                        value: nbt.compound.network,
                      },
                    })
                  ),
                },
              ]),
            },
            remove: {
              type: 1,
              value: native.empty,
            },
            update: {
              type: 2,
              value: combined([
                { name: "objective_value", protocol: mcp.string },
                {
                  name: "type",
                  protocol: mcp.enum(mcp.varint, ["integer", "hearts"]),
                },
                {
                  name: "format",
                  protocol: mcp.optional(
                    switch_on_type2(mcp.varint, {
                      blank: {
                        type: 0,
                        value: native.empty,
                      },
                      styled: {
                        type: 1,
                        value: nbt.compound.network,
                      },
                    })
                  ),
                },
              ]),
            },
          }),
        },
      ]
    ),

    player_info_remove: mcp.Packet(
      packets.play.clientbound["minecraft:player_info_remove"].protocol_id,
      [{ name: "uuids", protocol: mcp.list(mcp.UUID) }]
    ),
    player_info_update: mcp.Packet(
      packets.play.clientbound["minecraft:player_info_update"].protocol_id,
      [
        {
          name: "actions",
          protocol: dynamic_enum(
            mcp.bitmask([
              "add_player",
              "initialize_chat",
              "update_game_mode",
              "update_listed",
              "update_latency",
              "update_display_name",
            ]),
            (actions) => {
              return mcp.list(
                combined([
                  { name: "uuid", protocol: mcp.UUID },
                  {
                    name: "actions",
                    protocol: combined([
                      ...[
                        actions.has("add_player") && {
                          name: "add_player",
                          protocol: combined([
                            { name: "name", protocol: mcp.string },
                            {
                              name: "properties",
                              protocol: mcp.list(
                                combined([
                                  { name: "name", protocol: mcp.string },
                                  { name: "value", protocol: mcp.string },
                                  {
                                    name: "signature",
                                    protocol: mcp.optional(mcp.string),
                                  },
                                ])
                              ),
                            },
                          ]),
                        },
                        actions.has("initialize_chat") && {
                          name: "initialize_chat",
                          protocol: mcp.optional(
                            combined([
                              { name: "chat_session_id", protocol: mcp.UUID },
                              {
                                name: "public_key_expiry",
                                protocol: mcp.Long,
                              },
                              {
                                name: "encoded_public_key",
                                protocol: but_as_uint8array(mcp.varint),
                              },
                              {
                                name: "public_key",
                                protocol: but_as_uint8array(mcp.varint),
                              },
                            ])
                          ),
                        },
                        actions.has("update_game_mode") && {
                          name: "update_game_mode",
                          protocol: game_mode_varint,
                        },
                        actions.has("update_listed") && {
                          name: "update_listed",
                          protocol: mcp.boolean,
                        },
                        actions.has("update_latency") && {
                          name: "update_latency",
                          protocol: mcp.varint,
                        },
                        actions.has("update_display_name") && {
                          name: "update_display_name",
                          protocol: mcp.optional(mcp.text_component),
                        },
                      ].filter((x) => x !== false),

                      // ...Array.from(actions).map((x) => {
                      //   if (x === "add_player") {
                      //     return {
                      //       name: "add_player",
                      //       protocol: combined([
                      //         { name: "name", protocol: mcp.string },
                      //         {
                      //           name: "properties",
                      //           protocol: mcp.list(
                      //             combined([
                      //               { name: "name", protocol: mcp.string },
                      //               { name: "value", protocol: mcp.string },
                      //               {
                      //                 name: "signature",
                      //                 protocol: mcp.optional(mcp.string),
                      //               },
                      //             ])
                      //           ),
                      //         },
                      //       ]),
                      //     } as const;
                      //   } else if (x === "initialize_chat") {
                      //     return {
                      //       name: "initialize_chat",
                      //       protocol: mcp.optional(
                      //         combined([
                      //           { name: "chat_session_id", protocol: mcp.UUID },
                      //           {
                      //             name: "public_key_expiry",
                      //             protocol: mcp.Long,
                      //           },
                      //           {
                      //             name: "encoded_public_key",
                      //             protocol: native.with_byte_length(
                      //               mcp.varint,
                      //               native.uint8array
                      //             ),
                      //           },
                      //           {
                      //             name: "public_key",
                      //             protocol: native.with_byte_length(
                      //               mcp.varint,
                      //               native.uint8array
                      //             ),
                      //           },
                      //         ])
                      //       ),
                      //     } as const;
                      //   } else if (x === "update_game_mode") {
                      //     return {
                      //       name: "update_game_mode",
                      //       protocol: game_mode_varint,
                      //     } as const;
                      //   } else if (x === "update_listed") {
                      //     return {
                      //       name: "update_listed",
                      //       protocol: mcp.boolean,
                      //     } as const;
                      //   } else if (x === "update_latency") {
                      //     return {
                      //       name: "update_latency",
                      //       protocol: mcp.varint,
                      //     } as const;
                      //   } else if (x === "update_display_name") {
                      //     return {
                      //       name: "update_display_name",
                      //       protocol: mcp.optional(mcp.text_component),
                      //     } as const;
                      //   } else {
                      //     throw new Error(`Unknown action: ${x}`);
                      //   }
                      // }),
                    ]),
                  },
                ])
              );
            }
          ),
        },
      ]
    ),
    block_changed_ack: mcp.Packet(
      packets.play.clientbound["minecraft:block_changed_ack"].protocol_id,
      [{ name: "sequence_id", protocol: mcp.varint }]
    ),
    set_chunk_cache_center: mcp.Packet(
      packets.play.clientbound["minecraft:set_chunk_cache_center"].protocol_id,
      [
        { name: "chunk_x", protocol: mcp.varint },
        { name: "chunk_z", protocol: mcp.varint },
      ]
    ),
    keep_alive: mcp.Packet(
      packets.play.clientbound["minecraft:keep_alive"].protocol_id,
      [{ name: "id", protocol: mcp.Long }]
    ),
    resource_pack_push: mcp.Packet(
      packets.play.clientbound["minecraft:resource_pack_push"].protocol_id,
      [
        { name: "uuid", protocol: mcp.UUID },
        { name: "url", protocol: mcp.string },
        { name: "hash", protocol: mcp.string },
        { name: "forced", protocol: mcp.boolean },
        { name: "prompt", protocol: mcp.optional(mcp.text_component) },
      ]
    ),
    resource_pack_pop: mcp.Packet(
      packets.play.clientbound["minecraft:resource_pack_pop"].protocol_id,
      [{ name: "uuid", protocol: mcp.optional(mcp.UUID) }]
    ),

    map_item_data: mcp.Packet(
      packets.play.clientbound["minecraft:map_item_data"].protocol_id,
      [
        { name: "map_id", protocol: mcp.varint },
        { name: "scale", protocol: mcp.enum(mcp.Byte, [0, 1, 2, 3, 4]) },
        { name: "locked", protocol: mcp.boolean },
        {
          name: "icons",
          protocol: mcp.optional(
            mcp.list(
              combined([
                {
                  name: "type",
                  protocol: mcp.enum(mcp.varint, [
                    "white_arrow",
                    "green_arrow",
                    "red_arrow",
                    "blue_arrow",
                    "white_cross",
                    "red_pointer",
                    "white_circle",
                    "small_white_circle",
                    "mansion",
                    "monument",
                    "white_banner",
                    "orange_banner",
                    "magenta_banner",
                    "light_blue_banner",
                    "yellow_banner",
                    "lime_banner",
                    "pink_banner",
                    "gray_banner",
                    "light_gray_banner",
                    "cyan_banner",
                    "purple_banner",
                    "blue_banner",
                    "brown_banner",
                    "green_banner",
                    "red_banner",
                    "black_banner",
                    "treasure_marker",
                  ]),
                },
                { name: "x", protocol: mcp.Byte },
                { name: "z", protocol: mcp.Byte },
                {
                  name: "direction",
                  protocol: mcp.enum(
                    mcp.Byte,
                    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
                  ),
                },
                { name: "display_name", protocol: mcp.optional(mcp.string) },
              ])
            )
          ),
        },

        /// Actually the rest is optional but nahh
        { name: "columns", protocol: mcp.UnsignedByte },
        { name: "rows", protocol: mcp.UnsignedByte },
        { name: "x", protocol: mcp.UnsignedByte },
        { name: "z", protocol: mcp.UnsignedByte },
        {
          name: "data",
          protocol: native.with_byte_length(mcp.varint, native.uint8array),
        },
      ]
    ),

    update_advancements: mcp.Packet(
      packets.play.clientbound["minecraft:update_advancements"].protocol_id,
      [
        { name: "reset", protocol: mcp.boolean },
        {
          name: "advancements",
          protocol: mcp.list(
            combined([
              { name: "id", protocol: mcp.string },
              {
                name: "advancement",
                protocol: combined([
                  { name: "parent", protocol: mcp.optional(mcp.string) },
                  {
                    name: "display",
                    protocol: mcp.optional(
                      combined([
                        { name: "title", protocol: mcp.text_component },
                        { name: "description", protocol: mcp.text_component },
                        { name: "icon", protocol: SlotProtocol },
                        {
                          name: "frame",
                          protocol: mcp.enum(mcp.varint, [
                            "task",
                            "challenge",
                            "goal",
                          ]),
                        },
                        {
                          name: "display",
                          protocol: switch_on_type2(mcp.Int, {
                            none: {
                              type: 0,
                              value: native.empty,
                            },
                            background: {
                              type: 1,
                              value: mcp.string,
                            },
                            show_toast: {
                              type: 2,
                              value: native.empty,
                            },
                            background_and_show_toast: {
                              type: 3,
                              value: mcp.string,
                            },
                            hidden: {
                              type: 4,
                              value: native.empty,
                            },
                            background_and_hidden: {
                              type: 5,
                              value: mcp.string,
                            },
                            show_toast_and_hidden: {
                              type: 6,
                              value: native.empty,
                            },
                            background_show_toast_and_hidden: {
                              type: 7,
                              value: mcp.string,
                            },
                          }),
                        },
                        /// Should be optional based on flags, can't be arsed rn
                        // { name: 'background', protocol: mcp.optional(mcp.string) },
                        { name: "x", protocol: mcp.Float },
                        { name: "y", protocol: mcp.Float },
                      ])
                    ),
                  },
                  {
                    name: "criteria",
                    protocol: mcp.list(mcp.list(mcp.string)),
                  },
                  { name: "telemetry", protocol: mcp.boolean },
                  // { name: "criteria", protocol: mcp.list(mcp.string) },
                  // { name: "done", protocol: mcp.boolean },
                  // { name: "time", protocol: mcp.Long },
                ]),
              },
            ])
          ),
        },
        {
          name: "removed",
          protocol: mcp.list(mcp.string),
        },
        {
          name: "progress",
          protocol: mcp.list(
            combined([
              { name: "identifier", protocol: mcp.string },
              {
                name: "value",
                protocol: mcp.list(
                  combined([
                    { name: "identifier", protocol: mcp.string },
                    { name: "achieved", protocol: mcp.optional(mcp.Long) },
                  ])
                ),
              },
            ])
          ),
        },
      ]
    ),

    section_blocks_update: mcp.Packet(
      packets.play.clientbound["minecraft:section_blocks_update"].protocol_id,
      [
        {
          name: "chunk",
          protocol: {
            encode: (chunk: { x: number; y: number; z: number }) => {
              // Encode x in the first 22 bits, z in the next 22 and y in the last 20
              let x = BigInt(chunk.x) & 0x3fffffn;
              let z = BigInt(chunk.z) & 0x3fffffn;
              let y = BigInt(chunk.y) & 0xfffffn;
              let buffer = new Uint8Array(8);
              let dataview = new DataView(buffer.buffer);
              dataview.setBigInt64(0, (x << 42n) | (z << 20n) | y, false);
              return buffer;
            },
            decode: (buffer: Uint8Array) => {
              let x = (buffer[0] << 16) | (buffer[1] << 8) | buffer[2];
              let z = (buffer[3] << 16) | (buffer[4] << 8) | buffer[5];
              let y = (buffer[6] << 12) | (buffer[7] << 4);
              return [{ x, y, z }, 8];
            },
          } satisfies Protocol<{ x: number; y: number; z: number }>,
        },
        {
          name: "blocks",
          protocol: {
            encode: (
              blocks: Array<{
                block: number;
                position: { x: number; y: number; z: number };
              }>
            ) => {
              /// Each entry is composed of the block state id, shifted left by 12, and the relative block position in the chunk section (4 bits for x, z, and y, from left to right).
              /// In a bigint, this would be
              return concat([
                mcp.varint.encode(blocks.length),
                ...blocks.map((block) => {
                  return mcp.varint.encode(
                    (block.block << 12) |
                      (block.position.x << 8) |
                      (block.position.z << 4) |
                      block.position.y
                  );
                }),
              ]);
              // for (let i = 0; i < blocks.length; i++) {}
              // return concat([mcp.varint.encode(blocks.length), buffer]);
            },
            decode: (buffer: Uint8Array) => {
              let [length, offset] = mcp.varint.decode(buffer);
              let results: Array<{
                block: number;
                position: { x: number; y: number; z: number };
              }> = [];
              for (let i = 0; i < length; i++) {
                let [value, value_offset] = mcp.varint.decode(
                  buffer.subarray(offset)
                );
                results.push({
                  block: value >> 12,
                  position: {
                    x: (value >> 8) & 0xf,
                    z: (value >> 4) & 0xf,
                    y: value & 0xf,
                  },
                });
                offset += value_offset;
              }
              return [results, offset];
            },
          } satisfies Protocol<
            Array<{
              block: number;
              position: { x: number; y: number; z: number };
            }>
          >,
        },
      ]
    ),
    block_update: mcp.Packet(
      packets.play.clientbound["minecraft:block_update"].protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "block", protocol: mcp.varint },
      ]
    ),
    block_entity_data: mcp.Packet(
      packets.play.clientbound["minecraft:block_entity_data"].protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "type", protocol: mcp.varint },
        { name: "nbt", protocol: nbt.any.network },
      ]
    ),

    update_tags: mcp.Packet(
      packets.play.clientbound["minecraft:update_tags"].protocol_id,
      [
        {
          name: "registries",
          protocol: mcp.list(
            combined([
              { name: "registry", protocol: mcp.string },
              {
                name: "tags",
                protocol: mcp.list(
                  combined([
                    { name: "name", protocol: mcp.string },
                    { name: "entries", protocol: mcp.list(mcp.varint) },
                  ])
                ),
              },
            ])
          ),
        },
      ]
    ),

    set_default_spawn_position: mcp.Packet(
      packets.play.clientbound["minecraft:set_default_spawn_position"]
        .protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "angle", protocol: mcp.Float },
      ]
    ),
    custom_chat_completions: mcp.Packet(
      packets.play.clientbound["minecraft:custom_chat_completions"].protocol_id,
      [
        {
          name: "action",
          protocol: mcp.enum(mcp.varint, ["add", "remove", "set"]),
        },
        {
          name: "entries",
          protocol: mcp.list(mcp.string),
        },
      ]
    ),
    set_carried_item: mcp.Packet(
      packets.play.clientbound["minecraft:set_carried_item"].protocol_id,
      [{ name: "slot", protocol: mcp.Byte }]
    ),

    set_time: mcp.Packet(
      packets.play.clientbound["minecraft:set_time"].protocol_id,
      [
        { name: "world_age", protocol: mcp.Long },
        { name: "time", protocol: mcp.Long },
      ]
    ),
    set_subtitle_text: mcp.Packet(
      packets.play.clientbound["minecraft:set_subtitle_text"].protocol_id,
      [{ name: "subtitle", protocol: mcp.text_component }]
    ),
    set_title_text: mcp.Packet(
      packets.play.clientbound["minecraft:set_title_text"].protocol_id,
      [{ name: "title", protocol: mcp.text_component }]
    ),
    set_titles_animation: mcp.Packet(
      packets.play.clientbound["minecraft:set_titles_animation"].protocol_id,
      [
        { name: "fade_in", protocol: mcp.Int },
        { name: "stay", protocol: mcp.Int },
        { name: "fade_out", protocol: mcp.Int },
      ]
    ),
    set_action_bar_text: mcp.Packet(
      packets.play.clientbound["minecraft:set_action_bar_text"].protocol_id,
      [{ name: "text", protocol: mcp.text_component }]
    ),

    transfer: mcp.Packet(
      packets.play.clientbound["minecraft:transfer"].protocol_id,
      [
        { name: "host", protocol: mcp.string },
        { name: "port", protocol: mcp.varint },
      ]
    ),
    boss_event: mcp.Packet(
      packets.play.clientbound["minecraft:boss_event"].protocol_id,
      [
        { name: "uuid", protocol: mcp.UUID },
        {
          name: "action",
          protocol: mcp.switch_on(
            mcp.enum(mcp.varint, [
              "add",
              "remove",
              "update_health",
              "update_title",
              "update_style",
              "update_flags",
            ]),
            {
              add: combined([
                { name: "title", protocol: mcp.text_component },
                { name: "health", protocol: mcp.Float },
                { name: "color", protocol: bossbar_color },
                { name: "division", protocol: bossbar_notches },
                { name: "flags", protocol: bossbar_flags },
              ]),
              remove: native.empty,
              update_health: combined([
                { name: "health", protocol: mcp.Float },
              ]),
              update_title: combined([
                { name: "title", protocol: mcp.text_component },
              ]),
              update_style: combined([
                { name: "color", protocol: bossbar_color },
                { name: "division", protocol: bossbar_notches },
              ]),
              update_flags: combined([
                { name: "flags", protocol: bossbar_flags },
              ]),
            }
          ),
        },
        // { name: "action", protocol: mcp.enum(mcp.varint, ["summon", "update", "remove"]) },
        // { name: "health", protocol: mcp.Float },
        // { name: "title", protocol: mcp.text_component },
        // { name: "flags", protocol: mcp.bitmask(["darken_sky", "play_music", "create_fog"]) },
        // { name: "overlay", protocol: mcp.enum(mcp.varint, ["progress", "notch"]) },
        // { name: "color", protocol: mcp.varint },
        // { name: "style", protocol: mcp.enum(mcp.varint, ["progress", "notch"]) },
      ]
    ),

    /// Because I have no idea how I'm going to implement this "bitmask for actions" business...
    /// https://wiki.vg/Protocol#Player_Info_Update
    player_info_update_BASIC: mcp.Packet(
      packets.play.clientbound["minecraft:player_info_update"].protocol_id,
      [
        { protocol: prefilled(mcp.Byte, 0x01) },
        {
          name: "players",
          protocol: mcp.list(
            combined([
              { name: "uuid", protocol: mcp.UUID },
              {
                name: "actions",
                protocol: combined([
                  { name: "name", protocol: mcp.string },
                  {
                    name: "properties",
                    protocol: mcp.list(
                      combined([
                        { name: "name", protocol: mcp.string },
                        { name: "value", protocol: mcp.string },
                        { name: "signature", protocol: mcp.string },
                      ])
                    ),
                  },
                ]),
              },
            ])
          ),
        },
      ]
    ),

    container_set_slot: mcp.Packet(
      packets.play.clientbound["minecraft:container_set_slot"].protocol_id,
      [
        { name: "window_id", protocol: mcp.Byte },
        { name: "state_id", protocol: mcp.varint },
        { name: "slot", protocol: mcp.Short },
        { name: "slot_data", protocol: SlotProtocol },
      ]
    ),
    container_set_content: mcp.Packet(
      packets.play.clientbound["minecraft:container_set_content"].protocol_id,
      [
        { name: "window_id", protocol: mcp.Byte },
        { name: "state_id", protocol: mcp.varint },
        { name: "slots", protocol: mcp.list(SlotProtocol) },
        { name: "carried_item", protocol: SlotProtocol },
      ]
    ),
    container_set_data: mcp.Packet(
      packets.play.clientbound["minecraft:container_set_data"].protocol_id,
      [
        { name: "window_id", protocol: mcp.Byte },
        { name: "property", protocol: mcp.Short },
        { name: "value", protocol: mcp.Short },
      ]
    ),

    disguised_chat: mcp.Packet(
      packets.play.clientbound["minecraft:disguised_chat"].protocol_id,
      [
        { name: "message", protocol: mcp.text_component },
        { name: "chat_type", protocol: mcp.varint },
        { name: "sender_name", protocol: mcp.text_component },
        { name: "target_name", protocol: mcp.optional(mcp.text_component) },
      ]
    ),
    player_abilities: mcp.Packet(
      packets.play.clientbound["minecraft:player_abilities"].protocol_id,
      [
        {
          name: "flags",
          protocol: mcp.bitmask([
            "invulnerable",
            "flying",
            "allow_flying",
            "creative_mode",
          ]),
        },
        { name: "flying_speed", protocol: mcp.Float },
        { name: "field_of_view_modifier", protocol: mcp.Float },
      ]
    ),

    player_position: mcp.Packet(
      packets.play.clientbound["minecraft:player_position"].protocol_id,
      [
        { name: "x", protocol: mcp.Double },
        { name: "y", protocol: mcp.Double },
        { name: "z", protocol: mcp.Double },
        { name: "yaw", protocol: mcp.Float },
        { name: "pitch", protocol: mcp.Float },
        { protocol: prefilled(mcp.UnsignedByte, 0) },
        { name: "teleport_id", protocol: mcp.varint },
      ]
    ),
    forget_level_chunk: mcp.Packet(
      packets.play.clientbound["minecraft:forget_level_chunk"].protocol_id,
      [
        { name: "chunk_z", protocol: mcp.Int },
        { name: "chunk_x", protocol: mcp.Int },
      ]
    ),

    level_chunk_with_light: mcp.Packet(
      packets.play.clientbound["minecraft:level_chunk_with_light"].protocol_id,
      [
        { name: "chunk_x", protocol: mcp.Int },
        { name: "chunk_z", protocol: mcp.Int },

        /// My NBT part is so buggy, this definitely does not parse correctly, but at least it parses the shape!
        { name: "heightmap", protocol: but_as_uint8array(nbt.any.network) },

        {
          name: "data",
          protocol: native.with_byte_length(
            mcp.varint,
            repeat_360_noscope(
              combined([
                { name: "non_air_count", protocol: mcp.Short },

                {
                  name: "blocks",
                  /// TODO These can be ranges, actually, so should make a switch_on_prefix
                  /// .... that can handle ranges like that
                  protocol: switch_on_type(
                    // @ts-ignore
                    wrap({
                      protocol: mcp.UnsignedByte,
                      encode: (x: "single-valued" | "indirect" | "direct") =>
                        x === "single-valued" ? 0
                        : x === "indirect" ? 4
                        : 15,
                      decode: (x) => {
                        return (
                          x < 4 ? "single-valued"
                          : x <= 8 ? "indirect"
                          : "direct"
                        );
                      },
                    }),
                    {
                      "single-valued": combined([
                        {
                          name: "pallete",
                          protocol: mcp.varint,
                        },
                        /// This array will always be empty
                        {
                          name: "data",
                          protocol: LongArrayAsUint8Array,
                        },
                      ]),

                      indirect: combined([
                        {
                          name: "pallete",
                          protocol: native.repeated(mcp.varint, mcp.varint),
                        },
                        {
                          name: "data",
                          /// Again, it is a array of longs, but uint8array feels more natural
                          protocol: LongArrayAsUint8Array,
                        },
                      ]),
                      direct: combined([
                        {
                          name: "data",
                          /// Again, it is a array of longs, but uint8array feels more natural
                          protocol: LongArrayAsUint8Array,
                        },
                      ]),
                    }
                  ),
                },

                {
                  name: "biome",
                  /// TODO These can be ranges, actually, so should make a switch_on_prefix
                  /// .... that can handle ranges like that
                  protocol: switch_on_type(
                    // @ts-ignore
                    wrap<number, "single-valued" | "indirect" | "direct">({
                      protocol: mcp.UnsignedByte,
                      encode: (x) =>
                        x === "single-valued" ? 0
                        : x === "indirect" ? 1
                        : 6,
                      decode: (x) =>
                        x < 1 ? "single-valued"
                        : x <= 3 ? "indirect"
                        : "direct",
                    }),
                    {
                      "single-valued": combined([
                        {
                          name: "pallete",
                          protocol: mcp.varint,
                        },
                        /// This array will always be empty
                        {
                          name: "data",
                          protocol: native.repeated(mcp.varint, mcp.Long),
                        },
                      ]),

                      indirect: combined([
                        {
                          name: "pallete",
                          protocol: native.repeated(mcp.varint, mcp.varint),
                        },
                        {
                          name: "data",
                          /// Again, it is a array of longs, but uint8array feels more natural
                          protocol: native.repeated(mcp.varint, mcp.Long),
                        },
                      ]),
                      direct: combined([
                        {
                          name: "data",
                          /// Again, it is a array of longs, but uint8array feels more natural
                          protocol: native.repeated(mcp.varint, mcp.Long),
                        },
                      ]),
                    }
                  ),
                },
              ])
            )
          ),
        },

        {
          name: "block_entities",
          protocol: mcp.list(
            combined([
              {
                name: "position_in_chunk",
                protocol: {
                  encode: (position: { x: number; y: number; z: number }) => {
                    /// packed_xz = ((blockX & 15) << 4) | (blockZ & 15) // encode
                    /// x = packed_xz >> 4, z = packed_xz & 15 // decode
                    return concat([
                      mcp.UnsignedByte.encode(
                        (position.x & (15 << 4)) | (position.z & 15)
                      ),
                      mcp.Short.encode(position.y),
                    ]);
                  },
                  decode: (buffer: Uint8Array) => {
                    let [packed_xz, offset] = mcp.UnsignedByte.decode(buffer);
                    let [y, offset2] = mcp.Short.decode(
                      buffer.subarray(offset)
                    );

                    return [
                      {
                        y: y,
                        x: packed_xz >> 4,
                        z: packed_xz & 15,
                      },
                      offset + offset2,
                    ];
                  },
                } satisfies Protocol<{ x: number; y: number; z: number }>,
              },
              { name: "type", protocol: mcp.varint },
              { name: "nbt", protocol: nbt.any.network },
            ])
          ),
        },

        /// In the protocol it says these are "Arrays of Longs",
        /// but they are used as "BitSet", so uint8array seems more appropriate
        {
          name: "Sky Light Mask",
          protocol: native.with_byte_length(
            wrap({
              protocol: mcp.varint,
              encode: (x) => {
                if (x % 8 === 0) {
                  return x / 8;
                } else {
                  throw new Error(
                    `Block Light Mask length is not a multiple of 8`
                  );
                }
              },
              decode: (x) => x * 8,
            }),
            native.uint8array
          ),
        },
        {
          name: "Block Light Mask",
          protocol: native.with_byte_length(
            wrap({
              protocol: mcp.varint,
              encode: (x) => {
                if (x % 8 === 0) {
                  return x / 8;
                } else {
                  throw new Error(
                    `Block Light Mask length is not a multiple of 8`
                  );
                }
              },
              decode: (x) => x * 8,
            }),
            native.uint8array
          ),
        },

        {
          name: "Empty Sky Light Mask",
          protocol: native.with_byte_length(
            wrap({
              protocol: mcp.varint,
              encode: (x) => Math.ceil(x / 8),
              decode: (x) => x * 8,
            }),
            native.uint8array
          ),
        },
        {
          name: "Empty Block Light Mask",
          protocol: native.with_byte_length(
            wrap({
              protocol: mcp.varint,
              encode: (x) => Math.ceil(x / 8),
              decode: (x) => x * 8,
            }),
            native.uint8array
          ),
        },
        {
          name: "Sky Light Arrays",
          protocol: native.repeated(
            mcp.varint,
            native.with_byte_length(mcp.varint, native.uint8array)
          ),
        },
        {
          name: "Block Light arrays",
          protocol: native.repeated(
            mcp.varint,
            native.with_byte_length(mcp.varint, native.uint8array)
          ),
        },
      ]
    ),

    game_event: mcp.Packet(
      packets.play.clientbound["minecraft:game_event"].protocol_id,
      [
        {
          name: "event",
          protocol: switch_on_type(
            mcp.enum(mcp.varint, [
              "no_respawn_block_available",
              "start_raining",
              "end_raining",
              "change_game_mode",
              "win_game",
              "demo_event",
              "arrow_hit_player",
              "rain_level_change",
              "thunder_level_change",
              "puffer_fish_sting",
              "elder_guardian_apperance",
              "enable_respawn_screen",
              "limited_crafting",
              "start_waiting_for_level_chunks",
            ]),
            {
              no_respawn_block_available: native.irrelevant(4),
              start_raining: native.irrelevant(4),
              end_raining: native.irrelevant(4),
              change_game_mode: mcp.enum(mcp.Float, [
                "survival",
                "creative",
                "adventure",
                "spectator",
              ]),
              win_game: mcp.enum(mcp.Float, ["just_respawn", "roll_credits"]),
              /// TODO Need to work with enums that are not incremental
              demo_event: mcp.Float,
              arrow_hit_player: native.irrelevant(4),
              rain_level_change: mcp.Float,
              thunder_level_change: mcp.Float,
              puffer_fish_sting: native.irrelevant(4),
              elder_guardian_apperance: native.irrelevant(4),
              enable_respawn_screen: mcp.enum(mcp.Float, [true, false]),
              limited_crafting: mcp.enum(mcp.Float, [false, true]),
              start_waiting_for_level_chunks: native.irrelevant(4),
            }
          ),
        },
        // { name: "event_id", protocol: mcp.UnsignedByte },
        // { name: "data", protocol: mcp.Float },
      ]
    ),
    login: mcp.Packet(packets.play.clientbound["minecraft:login"].protocol_id, [
      { name: "entity_id", protocol: mcp.Int },
      { name: "is_hardcore", protocol: mcp.boolean },
      { name: "dimensions", protocol: mcp.list(mcp.string) },
      { name: "max_players", protocol: mcp.varint },
      { name: "view_distance", protocol: mcp.varint },
      { name: "simulation_distance", protocol: mcp.varint },
      { name: "reduced_debug_info", protocol: mcp.boolean },
      { name: "enable_respawn_screen", protocol: mcp.boolean },
      { name: "limited_crafting", protocol: mcp.boolean },
      {
        name: "dimension",
        protocol: combined([
          { name: "type", protocol: mcp.varint },
          { name: "name", protocol: mcp.string },
        ]),
      },
      { name: "hashed_seed", protocol: mcp.Long },
      {
        name: "game_mode",
        protocol: game_mode_varint,
      },
      { name: "previous_game_mode", protocol: mcp.Byte },
      { name: "is_debug_world", protocol: mcp.boolean },
      { name: "is_flat_world", protocol: mcp.boolean },
      { name: "has_death_location", protocol: mcp.boolean },
      { name: "portal_cooldown", protocol: mcp.varint },
      { name: "secure_chat", protocol: mcp.boolean },
    ]),

    add_entity: mcp.Packet(
      packets.play.clientbound["minecraft:add_entity"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "entity_uuid", protocol: mcp.UUID },
        { name: "type", protocol: mcp.varint },
        { name: "x", protocol: mcp.Double },
        { name: "y", protocol: mcp.Double },
        { name: "z", protocol: mcp.Double },
        { name: "pitch", protocol: mcp.Angle },
        { name: "yaw", protocol: mcp.Angle },
        { name: "head_yaw", protocol: mcp.Angle },
        { name: "data", protocol: mcp.varint },
        { name: "velocity_x", protocol: mcp.Short },
        { name: "velocity_y", protocol: mcp.Short },
        { name: "velocity_z", protocol: mcp.Short },
      ]
    ),
    set_entity_data: mcp.Packet(
      packets.play.clientbound["minecraft:set_entity_data"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "metadata", protocol: entity_metadata_protocol },
      ]
    ),
    set_equipment: mcp.Packet(
      packets.play.clientbound["minecraft:set_equipment"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        {
          name: "equipment",
          protocol: {
            encode: (x) => {
              let buffer = new Uint8Array(0);
              for (let [index, item] of x.entries()) {
                let slot = slot_enum.encode(item.slot)[0];
                let data = SlotProtocol.encode(item.data);
                let slot_with_extra =
                  index === x.length - 1 ? slot : slot | 0b10000000;
                buffer = concat([
                  buffer,
                  new Uint8Array([slot_with_extra]),
                  data,
                ]);
              }
              return buffer;
            },
            decode: (buffer) => {
              let items: Array<{
                slot: ValueOfProtocol<typeof slot_enum>;
                data: ValueOfProtocol<typeof SlotProtocol>;
              }> = [];
              let list_offset = 0;
              while (true) {
                let next_buffer = buffer.subarray(list_offset);
                let slot = next_buffer[0] & 0b01111111;
                let has_extra = next_buffer[0] & 0b10000000;
                console.log(`slot:`, slot);
                let [slot_name] = slot_enum.decode(new Uint8Array([slot]));
                console.log(`slot_name:`, slot_name);

                let [slot_data, offset] = SlotProtocol.decode(
                  buffer.subarray(list_offset + 1)
                );
                list_offset = offset + 1;
                items.push({ slot: slot_name, data: slot_data });

                if (!has_extra) {
                  break;
                }
              }
              return [items, list_offset];
            },
          } satisfies Protocol<
            Array<{
              slot: ValueOfProtocol<typeof slot_enum>;
              data: ValueOfProtocol<typeof SlotProtocol>;
            }>
          >,
        },
      ]
    ),
    move_entity_pos: mcp.Packet(
      packets.play.clientbound["minecraft:move_entity_pos"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "delta_x", protocol: mcp.Short },
        { name: "delta_y", protocol: mcp.Short },
        { name: "delta_z", protocol: mcp.Short },
        { name: "on_ground", protocol: mcp.boolean },
      ]
    ),
    move_entity_pos_rot: mcp.Packet(
      packets.play.clientbound["minecraft:move_entity_pos_rot"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "delta_x", protocol: mcp.Short },
        { name: "delta_y", protocol: mcp.Short },
        { name: "delta_z", protocol: mcp.Short },
        { name: "yaw", protocol: mcp.Angle },
        { name: "pitch", protocol: mcp.Angle },
        { name: "on_ground", protocol: mcp.boolean },
      ]
    ),
    move_entity_rot: mcp.Packet(
      packets.play.clientbound["minecraft:move_entity_rot"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "yaw", protocol: mcp.Angle },
        { name: "pitch", protocol: mcp.Angle },
        { name: "on_ground", protocol: mcp.boolean },
      ]
    ),
    teleport_entity: mcp.Packet(
      packets.play.clientbound["minecraft:teleport_entity"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "x", protocol: mcp.Double },
        { name: "y", protocol: mcp.Double },
        { name: "z", protocol: mcp.Double },
        { name: "yaw", protocol: mcp.Angle },
        { name: "pitch", protocol: mcp.Angle },
        { name: "on_ground", protocol: mcp.boolean },
      ]
    ),
    set_entity_motion: mcp.Packet(
      packets.play.clientbound["minecraft:set_entity_motion"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "velocity_x", protocol: mcp.Short },
        { name: "velocity_y", protocol: mcp.Short },
        { name: "velocity_z", protocol: mcp.Short },
      ]
    ),
    rotate_head: mcp.Packet(
      packets.play.clientbound["minecraft:rotate_head"].protocol_id,
      [
        { name: "entity_id", protocol: mcp.varint },
        { name: "head_yaw", protocol: mcp.Angle },
      ]
    ),
    remove_entities: mcp.Packet(
      packets.play.clientbound["minecraft:remove_entities"].protocol_id,
      [{ name: "entities", protocol: mcp.list(mcp.varint) }]
    ),
  },
};
