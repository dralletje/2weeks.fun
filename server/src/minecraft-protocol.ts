import chalk from "chalk";
import {
  packets,
  registries,
} from "../../packages/@2weeks/minecraft-data/src/minecraft-data.ts";
import { nbt } from "./nbt-read.ts";
import {
  bytes,
  combined,
  concat,
  native,
  prefilled,
  type Protocol,
  switch_on_type,
  type ValueOfProtocol,
  wrap,
} from "./protocol.ts";
import { mcp } from "./mcp.ts";
import { brigadier_node } from "./protocol/brigadier.ts";

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

// let data Object.keys(registries["minecraft:data_component_type"].entries)

let data_components_enum = mcp.enum(mcp.varint, [
  "minecraft:custom_data",
  "minecraft:max_stack_size",
  "minecraft:max_damage",
  "minecraft:damage",
  "minecraft:unbreakable",
  "minecraft:custom_name",
  "minecraft:item_name",
  "minecraft:lore",
  "minecraft:rarity",
]);

let game_mode_varint = mcp.enum(mcp.varint, [
  "survival",
  "creative",
  "adventure",
  "spectator",
]);

let Slot = dynamic_enum(mcp.varint, (item_count) => {
  console.log(`item_count:`, item_count);
  if (item_count === 0) {
    return native.empty;
  } else {
    return combined([
      { name: "item_id", protocol: mcp.varint },
      {
        name: "components",
        protocol: dynamic_enum(
          combined([
            { name: "number_to_add", protocol: mcp.varint },
            { name: "number_to_remove", protocol: mcp.varint },
          ]),
          (x) => {
            console.log(`x:`, x);
            return combined([
              {
                name: "added",
                protocol: repeated_x(
                  x.number_to_add,
                  switch_on_type(data_components_enum, {
                    "minecraft:custom_data": nbt.compound.network,
                    "minecraft:max_stack_size": mcp.varint,
                    "minecraft:max_damage": mcp.varint,
                    "minecraft:damage": mcp.varint,
                    "minecraft:unbreakable": mcp.boolean,
                    "minecraft:custom_name": mcp.text_component,
                    "minecraft:item_name": mcp.text_component,
                    "minecraft:lore": wrap({
                      protocol: mcp.list(nbt.any.network),
                      encode: (x) => x,
                      decode: (x) => {
                        console.log(`x:`, x);
                        return x;
                      },
                    }),
                    "minecraft:rarity": mcp.enum(mcp.varint, [
                      "common",
                      "uncommon",
                      "rare",
                      "epic",
                    ]),
                  })
                ),
              },
              {
                name: "removed",
                protocol: repeated_x(x.number_to_remove, data_components_enum),
              },
            ]);
          }
        ),
      },
    ]);
  }
});

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
        { name: "port", protocol: bytes.uint16 },
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
      [{ name: "timestamp", protocol: bytes.int64 }]
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
      [{ name: "timestamp", protocol: bytes.int64 }]
    ),
  },
};

export let LoginPackets = {
  serverbound: {
    hello: mcp.Packet(
      packets.login.serverbound["minecraft:hello"].protocol_id,
      [
        { name: "name", protocol: mcp.string },
        { name: "uuid", protocol: bytes.uint128 },
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
        { name: "uuid", protocol: bytes.uint128 },
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
        { protocol: prefilled(bytes.uint8, 1) },
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
        { name: "view_distance", protocol: bytes.uint8 },
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
    accept_teleportation: mcp.Packet(
      packets.play.serverbound["minecraft:accept_teleportation"].protocol_id,
      [{ name: "teleport_id", protocol: mcp.varint }]
    ),
    chat_command: mcp.Packet(
      packets.play.serverbound["minecraft:chat_command"].protocol_id,
      [{ name: "command", protocol: mcp.string }]
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
      [{ name: "id", protocol: bytes.int64 }]
    ),

    set_create_mode_slot: mcp.Packet(
      packets.play.serverbound["minecraft:set_creative_mode_slot"].protocol_id,
      [
        { name: "slot", protocol: mcp.Short },
        { name: "clicked_item", protocol: Slot },
        // { name: "clicked_item", protocol: FilledSlot },
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
        { name: "cursor_x", protocol: mcp.Float },
        { name: "cursor_y", protocol: mcp.Float },
        { name: "cursor_z", protocol: mcp.Float },
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

    set_carried_item: mcp.Packet(
      packets.play.serverbound["minecraft:set_carried_item"].protocol_id,
      [{ name: "slot", protocol: mcp.Short }]
    ),

    move_player_pos: mcp.Packet(
      packets.play.serverbound["minecraft:move_player_pos"].protocol_id,
      [
        { name: "x", protocol: bytes.float64 },
        { name: "y", protocol: bytes.float64 },
        { name: "z", protocol: bytes.float64 },
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
  },

  clientbound: {
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
    tab_list: mcp.Packet(
      packets.play.clientbound["minecraft:tab_list"].protocol_id,
      [
        { name: "header", protocol: mcp.text_component },
        { name: "footer", protocol: mcp.text_component },
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
    player_info_remove: mcp.Packet(
      packets.play.clientbound["minecraft:player_info_remove"].protocol_id,
      [{ name: "uuid", protocol: mcp.UUID }]
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
            (actions) =>
              mcp.list(
                combined([
                  { name: "uuid", protocol: mcp.UUID },
                  {
                    name: "actions",
                    protocol: combined(
                      Array.from(actions).map((x) => {
                        if (x === "add_player") {
                          return {
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
                          } as const;
                        } else if (x === "initialize_chat") {
                          return {
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
                                  protocol: native.with_byte_length(
                                    mcp.varint,
                                    native.uint8array
                                  ),
                                },
                                {
                                  name: "public_key",
                                  protocol: native.with_byte_length(
                                    mcp.varint,
                                    native.uint8array
                                  ),
                                },
                              ])
                            ),
                          } as const;
                        } else if (x === "update_game_mode") {
                          return {
                            name: "update_game_mode",
                            protocol: game_mode_varint,
                          } as const;
                        } else if (x === "update_listed") {
                          return {
                            name: "update_listed",
                            protocol: mcp.boolean,
                          } as const;
                        } else if (x === "update_latency") {
                          return {
                            name: "update_latency",
                            protocol: mcp.varint,
                          } as const;
                        } else if (x === "update_display_name") {
                          return {
                            name: "update_display_name",
                            protocol: mcp.optional(mcp.text_component),
                          } as const;
                        } else {
                          throw new Error(`Unknown action: ${x}`);
                        }
                      })
                    ),
                  },
                ])
              )
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
      [{ name: "id", protocol: bytes.int64 }]
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

    block_update: mcp.Packet(
      packets.play.clientbound["minecraft:block_update"].protocol_id,
      [
        { name: "location", protocol: mcp.Position },
        { name: "block", protocol: mcp.varint },
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
        { name: "uuid", protocol: bytes.uint128 },
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
                { name: "health", protocol: bytes.float32 },
                { name: "color", protocol: bossbar_color },
                { name: "division", protocol: bossbar_notches },
                { name: "flags", protocol: bossbar_flags },
              ]),
              remove: native.empty,
              update_health: combined([
                { name: "health", protocol: bytes.float32 },
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
        // { name: "health", protocol: bytes.float32 },
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
        { protocol: prefilled(bytes.int8, 0x01) },
        {
          name: "players",
          protocol: mcp.list(
            combined([
              { name: "uuid", protocol: bytes.uint128 },
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
        { name: "slot_data", protocol: Slot },
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
        { name: "flying_speed", protocol: bytes.float32 },
        { name: "field_of_view_modifier", protocol: bytes.float32 },
      ]
    ),

    player_position: mcp.Packet(
      packets.play.clientbound["minecraft:player_position"].protocol_id,
      [
        { name: "x", protocol: bytes.float64 },
        { name: "y", protocol: bytes.float64 },
        { name: "z", protocol: bytes.float64 },
        { name: "yaw", protocol: bytes.float32 },
        { name: "pitch", protocol: bytes.float32 },
        { protocol: prefilled(bytes.uint8, 0) },
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
                    wrap<number, "single-valued" | "indirect" | "direct">({
                      protocol: mcp.UnsignedByte,
                      encode: (x) =>
                        x === "single-valued" ? 0 : x === "indirect" ? 4 : 15,
                      decode: (x) => {
                        return x < 4
                          ? "single-valued"
                          : x <= 8
                            ? "indirect"
                            : "direct";
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

                {
                  name: "biome",
                  /// TODO These can be ranges, actually, so should make a switch_on_prefix
                  /// .... that can handle ranges like that
                  protocol: switch_on_type(
                    // @ts-ignore
                    wrap<number, "single-valued" | "indirect" | "direct">({
                      protocol: mcp.UnsignedByte,
                      encode: (x) =>
                        x === "single-valued" ? 0 : x === "indirect" ? 1 : 6,
                      decode: (x) =>
                        x < 1
                          ? "single-valued"
                          : x <= 3
                            ? "indirect"
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
              /// Make a protocol for "Packed XZ"
              { name: "x_z", protocol: mcp.UnsignedByte },
              { name: "y", protocol: mcp.UnsignedByte },
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
        // { name: "event_id", protocol: bytes.uint8 },
        // { name: "data", protocol: bytes.float32 },
      ]
    ),
    login: mcp.Packet(packets.play.clientbound["minecraft:login"].protocol_id, [
      { name: "entity_id", protocol: bytes.int32 },
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
      { name: "hashed_seed", protocol: bytes.int64 },
      {
        name: "game_mode",
        protocol: game_mode_varint,
      },
      { name: "previous_game_mode", protocol: bytes.int8 },
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
                let data = Slot.encode(item.data);
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
                data: ValueOfProtocol<typeof Slot>;
              }> = [];
              let list_offset = 0;
              while (true) {
                let next_buffer = buffer.subarray(list_offset);
                let slot = next_buffer[0] & 0b01111111;
                let has_extra = next_buffer[0] & 0b10000000;
                console.log(`slot:`, slot);
                let [slot_name] = slot_enum.decode(new Uint8Array([slot]));
                console.log(`slot_name:`, slot_name);

                let [slot_data, offset] = Slot.decode(
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
              data: ValueOfProtocol<typeof Slot>;
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
