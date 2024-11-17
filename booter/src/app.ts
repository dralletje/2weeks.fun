import { decode_varint } from "@2weeks/binary-protocol/varint";
import { WithVarintLengthTransformStream } from "@2weeks/binary-protocol/WithVarintLengthTransformStream";
import {
  find_packet_name,
  packets,
} from "../../packages/@2weeks/minecraft-data/src/minecraft-data.ts";
import { type App } from "../../packages/@2weeks/tcp-workers/types.ts";
import chalk from "chalk";
import { chunk, range } from "lodash-es";

import { MinecraftDroplet } from "./digitalocean.ts";
import { HandshakePackets, StatusPackets } from "./minecraft-protocol.ts";
import { bytes, combined, mcp, native, prefilled, wrap } from "./protocol.ts";

// @ts-ignore
import level_chunk_with_light_flat_hex from "../data/level_chunk_with_light_flat.hex" with { type: "text" };
// @ts-ignore
import buffer_of_0x07s from "../data/buffer_of_0x07s.bin" with { type: "binary" };

let start_interval = (
  callback: () => void,
  options: { interval: number; signal: AbortSignal }
) => {
  let interval = setInterval(callback, options.interval * 1000);
  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      clearInterval(interval);
    });
  }
};

let CUTE_TEACUP =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAACDdJREFUeF7tmmtsVEUYht/dQtnaC1RaWkGRgCAIKWoR4iVqo/7wGtFEQEzw8kMlahDxEk2UixpI1DSiKKKBKgYvGNRYEEqVwtIABQq0SN3SCr1t2S5tt93SdmGL+Q5+63R6ztlzdrd1DTu/unPmzMz7fO98M+ecWnCRF8tFrh8xADEHXOQEYkvgIjdALAnGlsD/ZQmcc0w7L8910IT9YQcw7A76GyALjxtf0mcof+UNSl04IKIWgCy86lBqHwDjrm1R6sIBEZUASDxHnIST0Db3gj4AUtJywdcZhFk3RB0AFs8RT798niKcxIoQxN9NdXlKGwJFbjADIaoBsPhgAOg6QRiaWYLU9jnRD+DZ2zL6ZHQSsXLNFRCtLwIQIchuEAHQ32Yg9KsDtISu2tGounmQfQmAuK7F5MdJTy0fhOqCiAKQBWsJVVMvilezPkV9/u2ZgVuXb5ytCtHsUogIABauJtj952JDR4VUa34g+uINBIPEy4VhyCAGHACJl4WLot98+lNDAHj9k+XV1j73mXZ1b6AEQoQQAFBxFwblnAga4KAN9GYvi+dJiqKfnJamdDHtvXLVrmoKX1PqR40uDDhA3Pr4Jo740tXPKFUiCBFCvwFgm39SdCoAjQHQBGhiLHy0JRl3Zg/pI3jE3fcF6kbfsTzwNyW1xJbdaEne0OseT+OFoy4VSoDLc8aj5ny78pvHI/fR+C/ldiv1tBVSSY2kA8RIcyQIBNXTRCgaYoKiCRAELjIMAsEA2AHU1rXll8A92w9cEMSFhYt1JJ5cR+BFAEbFU19Bl4DWGqdBZQji5GQgfI3ByFBYsJpQulcrwdI8ln5jB7tFOQwZjH5QALJ4tjqLYctzJEQAcrLia1pg+LrW1qm2m7DzKPoknCCMaR1mKPnxeLoOkK3PEec12LZzH977+qBmdHp5+J8fWmC4rda2qQc0VPvrOkBNvCiIri+ae70mADXxVBfsXBAMkNyv4spv7Eq1GesHdUAwANSB3gFIC0Ak6zkBrlycoHRrZN+Xx9dcAkYAMAQzR97+ACBuzWb7N50D5AHUdgmzkwi1PTvgPwXALuDzgFEx66bb8Pi+rl7N1er0cglvxUbHVGtn2AF0MyUcNdrigcjIZEoXTMF1ueUQBavV6fUViejr7gI8uJFcYBaAEUjBxNP1fneAnOS0qDMAaq+1jVGEDxcf72N7LaF67cWHrnDWvyEHiGucJ8snQB7cCABZKFterDeSA+RH7QEBoAaBLcgC+DFVzwVqEKiOnEFFTopye/kQRYE4cNSjNNvn7gr6XGM6Cco38MFHFEvHYSp0JFZ7Vg+23inqZsXTmHNe/125b33B23A1dWLho++EBCIkagyCjsJcRABmXKAHaEb6hRNevv3VQDMWv/aHRRiemQa/qw2+zm501dWgdKsduYVOU24ICQDPRgQhAwgXAolft3UJ3A1uLHpipQKBxX+wbDYszipkZGcjPjkFfpcTbYcPYr+jGauLBhCADIJ+i8uDr5t9wCHxX363EEltHhzKL8TSTSew4d0cpTuy/vq8BbB6W+G070bCuImoOXQITa1+fGFvMBV96i8sB6jlCDUAYjstGGKCu/eWFXhn1gTYLD2odnXh49/qFAAk/q1HJmFizk3o6OiG49cCVFe1Y+NfZ0Ja/xEHQB3yY3LKrdOD5T/V6yR+7ecvoPkvJ9Z/9DNKPd29ov/+6zNRll+AimYb9tS6QxbOg0fUAeKSEBOkERgknMqSWRNx2ZQsfL+hGAV//Bt5urb4xQdRXFiGbUeqVIVPT7Mpn9zMbIkRByB/HRJBMCAGwlsoWXvdtwtR/+2PSBh7DQ7/bEeeozVg+1fnzkB82kjs2lyMHZWneglk0dT3trIPUeuox1MPrzAMIWwAsmDKAfyqjN8YsXA1GCT+xvRLMPPJu3Byy07UeOPg6bFg54kmZE9KxIFjHXjt+Zmw55fAXt3bEdTvh8tmw+sow/i5D+G8swn+tjb8vrEIn+2qNwQhZABqb4MokcnvCavX3BNY67RVyoVOclMTrZh8VQaS0oejod6NX441BqL/8u3paMZwtHf68d3eSuX2vLyFsLS3oKGoCJlZU9BcUYGk0ePgPVaO0509KKjwYd/Jpv4DoPc5TO9FqQhDBEEueOWOEZg652H4fWdxdNNmrChoQO4bD6CrtBjdQy5FYtJgxPk6cNaWjMypWcC5btTvsqPHGg9/tx/OqtNo9HThVEI6ig2KD2kXMCLe7JGY9v23H5uMUVlTED/YCs/BUtQdq0XG2DTEWS1ocPmRmjoEw9JsOH/ZGLRXHgc6zqCmqRNFBxphS0kBEpKw5+Qp07uC6SWg9QqM93F2AM1EPhOonQFI/OqvnkNK91nUbdkG6zkfbCkJaPH44PV4ETfEBleHBc21boy6Mhnjxo5A0jVTsWvNTyh1A4dbL5wBqOxt6tR8aaO1J5sGwHu93gcM8QFJHFhOgmT9VavmwVdSgsQrx8Jd7kDjH7WwZQxDseMMfD4/Wlrb4DhrDXTz4v3jMfLqSdi6aTe2V51WRHPRemOlJT6kJcCdGfmfAAbB98hJkBLg/JxMjEyKh8vlRbmzB97Oc/C0e/Gn8LqQToG8ddJ54aYrhsPb0YEjzV2BqNMYobwbCMkBIlF5G9T7XwEZCPVDLrh5TAYQZ8XuKmega/EJUF46/JSYPXmo0j4U4TxQ2ABke8lA+LretwMWJNqZ7tP6jhiOYHm+EQegtd60wOitz0gKjWgS1Jv0/+3agDkgWsHEAERrZAZqXjEHDBTpaB0n5oBojcxAzSvmgIEiHa3j/A3u6rd9ndE1UAAAAABJRU5ErkJggg==";

type DuplexStream<Read = Uint8Array, Write = Uint8Array> = {
  readable: ReadableStream<Read>;
  writable: WritableStream<Write>;
};

let hex_to_uint8array = (hex: string) => {
  let clustered = chunk(hex.replaceAll(/[^0-9A-Fa-f]/g, ""), 2);
  let bytes = clustered.map((byte) => parseInt(byte.join(""), 16));
  return new Uint8Array(bytes);
};
let uint8array_as_hex = (buffer: Uint8Array) => {
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
};

let read_required = async <T>(reader: ReadableStreamDefaultReader<T>) => {
  let { value, done } = await reader.read();
  if (done || !value) {
    throw new Error(`Connection closed`);
  }
  return value;
};

let read_single = async (readable_stream: ReadableStream<Uint8Array>) => {
  let reader = readable_stream.getReader();
  let { value, done } = await reader.read();
  reader.releaseLock();
  if (done || !value) {
    throw new Error(`Connection closed`);
  }
  return value;
};

let LoginPackets = {
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
        { protocol: prefilled(mcp.varint, 0) },
        { protocol: prefilled(bytes.uint8, 1) },
      ]
    ),
  },
};

let ConfigurationPackets = {
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
        {
          name: "entries",
          protocol: mcp.list(
            combined([
              { name: "identifier", protocol: mcp.string },
              { name: "data", protocol: mcp.string },
            ])
          ),
        },
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

let state_configuration = async ({
  socket: { readable, writable },
  droplet,
}: {
  socket: DuplexStream;
  droplet: MinecraftDroplet;
}) => {
  let writer = writable.getWriter();
  try {
    let status = await droplet.ping();
    if (status.status === "online") {
      // prettier-ignore
      console.log(chalk.green(`Server is online: ${status.ping.description} (${status.ping.players.online}/${status.ping.players.max})`));
      await writer.write(
        ConfigurationPackets.clientbound.transfer.write({
          host: status.hostname,
          port: status.port,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await writer.close();
      return;
    }

    await writer.write(
      ConfigurationPackets.clientbound.select_known_packs.write({
        packs: [{ namespace: "minecraft", id: "core", version: "1.21.1" }],
      })
    );

    await writer.write(
      ConfigurationPackets.clientbound.server_links.write({
        links: [
          {
            label: { true: "Bug Report" },
            url: "https://bugs.mojang.com",
          },
        ],
      })
    );

    for await (let packet of readable.values({ preventCancel: true })) {
      let [packet_id, offset] = decode_varint(packet);

      if (
        packet_id === ConfigurationPackets.serverbound.client_information.id
      ) {
        let stuff =
          ConfigurationPackets.serverbound.client_information.read(packet);
        console.log(`[CONFIGURATION] CLIENT_INFORMATION:`, stuff);
        /// Also ignoring!
      } else if (
        packet_id === ConfigurationPackets.serverbound.custom_payload.id
      ) {
        let { channel, data } =
          ConfigurationPackets.serverbound.custom_payload.read(packet);
        console.log(`[CONFIGURATION] PLUGIN_MESSAGE:`, channel);
        /// Ignoring!
      } else if (
        packet_id === ConfigurationPackets.serverbound.finish_configuration.id
      ) {
        let _ =
          ConfigurationPackets.serverbound.finish_configuration.read(packet);
        console.log(`[CONFIGURATION] ACKNOWLEDGE_FINISH_CONFIGURATION`);
        return;
      } else if (
        packet_id === ConfigurationPackets.serverbound.select_known_packs.id
      ) {
        let _ =
          ConfigurationPackets.serverbound.select_known_packs.read(packet);

        /// The default configuration packets which I got from the Notchian server
        await writer.write(buffer_of_0x07s);

        await writer.write(
          ConfigurationPackets.clientbound.finish_configuration.write({})
        );
      } else {
        console.log(`[CONFIGURATION] UNKNOWN PACKET:`, packet_id);
      }
    }

    throw new Error("Connection closed in configuration");
  } finally {
    writer.releaseLock();
  }
};

let bossbar_color = mcp.enum(mcp.varint, [
  "pink",
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "white",
]);
let bossbar_notches = mcp.enum(mcp.varint, [
  "none",
  "6 notches",
  "10 notches",
  "12 notches",
  "20 notches",
]);
let bossbar_flags = mcp.bitmask(["darken_sky", "play_music", "create_fog"]);

let PlayPackets = {
  serverbound: {},
  clientbound: {
    /// Complex!!
    /// https://wiki.vg/Protocol#Chunk_Data_and_Update_Light
    level_chunk_with_light_INCOMPLETE: mcp.Packet(
      packets.play.clientbound["minecraft:level_chunk_with_light"].protocol_id,
      [
        { name: "chunk_x", protocol: bytes.int32 },
        { name: "chunk_z", protocol: bytes.int32 },
        // { name: "heightmap", protocol: mcp.any_nbt },
        // { name: "heightmap", protocol: with_varint_length(native.uint8array) },
        // {
        //   name: "block_entities",
        //   protocol: mcp.list(
        //     combined([
        //       /// Make a protocol for "Packed XZ"
        //       { name: "position", protocol: bytes.uint8 },
        //     ])
        //   ),
        // },
        /// Can't be bothered to figure this out now
        { name: "rest", protocol: native.uint8array },
      ]
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

    player_position: mcp.Packet(0x40, [
      { name: "x", protocol: bytes.float64 },
      { name: "y", protocol: bytes.float64 },
      { name: "z", protocol: bytes.float64 },
      { name: "yaw", protocol: bytes.float32 },
      { name: "pitch", protocol: bytes.float32 },
      { protocol: prefilled(bytes.uint8, 0) },
      { name: "action_id", protocol: mcp.varint },
    ]),
    game_event: mcp.Packet(0x22, [
      { name: "event_id", protocol: bytes.uint8 },
      { name: "data", protocol: bytes.float32 },
    ]),
    login: mcp.Packet(0x2b, [
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
        protocol: mcp.enum(mcp.varint, [
          "survival",
          "creative",
          "adventure",
          "spectator",
        ]),
      },
      { name: "previous_game_mode", protocol: bytes.int8 },
      { name: "is_debug_world", protocol: mcp.boolean },
      { name: "is_flat_world", protocol: mcp.boolean },
      { name: "has_death_location", protocol: mcp.boolean },
      { name: "portal_cooldown", protocol: mcp.varint },
      { name: "secure_chat", protocol: mcp.boolean },
    ]),
  },
};

let level_chunk_with_light_flat_bytes = hex_to_uint8array(
  level_chunk_with_light_flat_hex
);
let level_chunk_with_light_flat =
  PlayPackets.clientbound.level_chunk_with_light_INCOMPLETE.read(
    level_chunk_with_light_flat_bytes
  );

let async = async (async) => async();

let state_PLAY = async ({
  socket: { readable, writable },
  uuid,
  droplet,
}: {
  socket: DuplexStream;
  uuid: bigint;
  droplet: MinecraftDroplet;
}) => {
  console.log("[PLAY] Entering PLAY state");
  let writer = writable.getWriter();
  try {
    let server_closed_controller = new AbortController();
    let server_closed_signal = server_closed_controller.signal;

    let minecraft_boot = droplet.boot();

    await writer.write(
      PlayPackets.clientbound.login.write({
        dimension: { name: "minecraft:overworld", type: 0 },
        dimensions: [
          "minecraft:overworld",
          "minecraft:the_end",
          "minecraft:the_nether",
        ],
        enable_respawn_screen: true,
        entity_id: 23,
        game_mode: "creative",
        hashed_seed: 5840439894700503850n,
        is_debug_world: false,
        is_flat_world: true,
        is_hardcore: false,
        reduced_debug_info: false,
        secure_chat: false,
        simulation_distance: 10,
        view_distance: 3,
        has_death_location: false,
        limited_crafting: false,
        max_players: 20,
        portal_cooldown: 0,
        previous_game_mode: 0,
      })
    );
    await writer.write(
      PlayPackets.clientbound.game_event.write({ event_id: 0x01, data: 0 })
    );
    await writer.write(
      PlayPackets.clientbound.game_event.write({ event_id: 0x07, data: 0 })
    );
    await writer.write(
      PlayPackets.clientbound.game_event.write({ event_id: 0x08, data: 0 })
    );
    await writer.write(
      PlayPackets.clientbound.game_event.write({ event_id: 0x0d, data: 0 })
    );

    console.log("[PLAY] Sent login packet");

    await writer.write(
      PlayPackets.clientbound.player_position.write({
        x: 8,
        y: 300,
        z: 8,
        yaw: 0,
        pitch: 0,
        action_id: 0,
      })
    );

    let accept_teleportation = mcp.Packet(
      packets.play.serverbound["minecraft:accept_teleportation"].protocol_id,
      [{ name: "teleport_id", protocol: mcp.varint }]
    );

    for await (let packet of readable.values({ preventCancel: true })) {
      let [packet_id, offset] = decode_varint(packet);

      if (packet_id === accept_teleportation.id) {
        /// Teleport confirm
        let { teleport_id } = accept_teleportation.read(packet);
        console.log(chalk.green("Teleport confirmed"));
        break;
      } else {
        console.log(
          chalk.blue(`[PLAY]`),
          chalk.red(
            find_packet_name({
              id: packet_id,
              state: "play",
              direction: "serverbound",
            })
          ),
          format_packet_id(packet_id)
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));
      }
    }

    await writer.write(
      PlayPackets.clientbound.player_info_update_BASIC.write({
        players: [
          {
            uuid: uuid,
            actions: {
              name: "Michiel Dral",
              properties: [],
            },
          },
        ],
      })
    );

    for (let x of range(-2, 3)) {
      for (let z of range(-2, 3)) {
        console.log(`[PLAY] Sending chunk at ${x},${z}`);
        await writer.write(
          PlayPackets.clientbound.level_chunk_with_light_INCOMPLETE.write({
            chunk_x: x,
            chunk_z: z,
            rest: level_chunk_with_light_flat.rest,
          })
        );
      }
    }

    await writer.write(
      PlayPackets.clientbound.disguised_chat.write({
        message: "Hello there!",
        chat_type: 1,
        sender_name: "michieldral",
        target_name: null,
      })
    );

    let current_health = 0.1;
    await writer.write(
      PlayPackets.clientbound.boss_event.write({
        uuid: BigInt(0),
        action: {
          type: "add",
          value: {
            title: "Starting server...",
            health: current_health,
            color: "blue",
            division: "20 notches",
            flags: ["create_fog"],
          },
        },
      })
    );
    start_interval(
      async () => {
        current_health = current_health + 0.05;
        if (current_health > 1) {
          current_health = 0.05;
        }

        await writer.write(
          PlayPackets.clientbound.boss_event.write({
            uuid: BigInt(0),
            action: {
              type: "update_health",
              value: {
                health: current_health,
              },
            },
          })
        );
      },
      {
        interval: 0.3,
        signal: server_closed_signal,
      }
    );

    await writer.write(
      PlayPackets.clientbound.player_position.write({
        x: 8,
        y: -60,
        z: 8,
        yaw: 0,
        pitch: 0,
        action_id: 0,
      })
    );

    start_interval(
      async () => {
        // await writer.write(
        //   PlayPackets.clientbound.player_position.write({
        //     x: 8,
        //     y: 0,
        //     z: 8,
        //     yaw: 0,
        //     pitch: 0,
        //     action_id: 0,
        //   })
        // );
        // await writer.write(
        //   PlayPackets.clientbound.player_abilities.write({
        //     flags: ["flying"],
        //     flying_speed: 0.05,
        //     field_of_view_modifier: 0.1,
        //   })
        // );
      },
      {
        interval: 10,
        signal: server_closed_signal,
      }
    );

    let keep_alive = mcp.Packet(
      packets.play.clientbound["minecraft:keep_alive"].protocol_id,
      [{ name: "id", protocol: bytes.int64 }]
    );

    await writer.write(keep_alive.write({ id: BigInt(Date.now()) }));
    start_interval(
      async () => {
        await writer.write(keep_alive.write({ id: BigInt(Date.now()) }));
      },
      {
        interval: 5,
        signal: server_closed_signal,
      }
    );

    let counter = 1;

    async(async () => {
      try {
        let x = await minecraft_boot;
        console.log(`x:`, x);
        await writer.write(
          PlayPackets.clientbound.transfer.write({
            host: x.hostname,
            port: x.port,
          })
        );
      } catch (error) {
        console.log(`error:`, error);
        console.error(error);
        writer.close();
      }
    });

    for await (let packet of readable.values({ preventCancel: true })) {
      let [packet_id, offset] = decode_varint(packet);

      let set_player_position = mcp.Packet(
        packets.play.serverbound["minecraft:move_player_pos"].protocol_id,
        [
          { name: "x", protocol: bytes.float64 },
          { name: "y", protocol: bytes.float64 },
          { name: "z", protocol: bytes.float64 },
          { name: "ground", protocol: mcp.boolean },
        ]
      );

      if (packet_id === 0x1a) {
        let { x, y, z, ground } = set_player_position.read(packet);
      } else {
        console.log(
          chalk.blue(`[PLAY]`),
          chalk.red(
            find_packet_name({
              id: packet_id,
              state: "play",
              direction: "serverbound",
            })
          ),
          format_packet_id(packet_id)
        );
        console.log(chalk.gray(uint8array_as_hex(packet)));
      }

      counter = counter + 1;
    }

    server_closed_controller.abort();
    throw new Error("Connection closed");
  } finally {
    writer.releaseLock();
  }
};

let state_STATUS = async ({
  socket: { readable, writable },
  droplet,
}: {
  socket: DuplexStream;
  droplet: MinecraftDroplet;
}) => {
  let writer = writable.getWriter();

  let VERSION = {
    name: "1.21.1",
    protocol: 767,
  };

  for await (let packet of readable) {
    let [packet_id, offset] = decode_varint(packet);

    if (packet_id === StatusPackets.serverbound.status_request.id) {
      /// STATUS
      let _ = StatusPackets.serverbound.status_request.read(packet);
      let status = await droplet.ping();

      if (status.status === "offline") {
        let response = {
          version: VERSION,
          players: {
            max: 20,
            online: 0,
            sample: [],
          },
          description: "Server is offline, connect to start it",
          favicon: CUTE_TEACUP,
        };
        await writer.write(
          StatusPackets.clientbound.status_response.write({ response })
        );
      } else if (status.status === "booting") {
        let response = {
          version: VERSION,
          players: {
            max: 20,
            online: 0,
            sample: [],
          },
          description: "Server is booting, connect to start playing",
          favicon: CUTE_TEACUP,
        };
        await writer.write(
          StatusPackets.clientbound.status_response.write({ response })
        );
      } else if (status.status === "online") {
        await writer.write(
          StatusPackets.clientbound.status_response.write({
            response: {
              ...status.ping,
              favicon: CUTE_TEACUP,
            },
          })
        );
      } else {
        // @ts-expect-error
        throw new Error(`Unknown status: ${status.status}`);
      }
    } else if (packet_id === StatusPackets.serverbound.ping_request.id) {
      /// PING
      let { timestamp } = StatusPackets.serverbound.ping_request.read(packet);
      await writer.write(
        StatusPackets.clientbound.pong_response.write({ timestamp })
      );
    }
  }
  writer.close();
};

let format_packet_id = (id: number) => `0x${id.toString(16).padStart(2, "0")}`;

export default {
  ports: [25564],
  async connect({ port, socket }, env) {
    if (env.DIGITAL_OCEAN_TOKEN == null) {
      throw new Error(`DIGITAL_OCEAN_TOKEN is required`);
    }

    let droplet = new MinecraftDroplet(env.DIGITAL_OCEAN_TOKEN);

    let packet_readable = socket.readable.pipeThrough(
      WithVarintLengthTransformStream()
    );

    let reader = packet_readable.getReader();
    let writer = socket.writable.getWriter();

    let handshake = HandshakePackets.serverbound.intention.read(
      await read_required(reader)
    );

    if (handshake.next_state === "status") {
      /// Necessary to switch to async iterator
      reader.releaseLock();
      writer.releaseLock();

      await state_STATUS({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
        droplet: droplet,
      });
    } else if (handshake.next_state === "login") {
      let { name, uuid } = LoginPackets.serverbound.hello.read(
        await read_required(reader)
      );
      await writer.write(
        LoginPackets.clientbound.game_profile.write({
          name: name,
          uuid: uuid,
        })
      );
      let _ = LoginPackets.serverbound.login_acknowledged.read(
        await read_required(reader)
      );

      reader.releaseLock();
      writer.releaseLock();
      await state_configuration({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
        droplet: droplet,
      });
      await state_PLAY({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
        uuid: uuid,
        droplet: droplet,
      });
    } else if (handshake.next_state === "transfer") {
      throw new Error("Unexpected next_state 3 (transer)");
    } else {
      throw new Error(`Unknown next_state: ${handshake.next_state}`);
    }
  },

  /// Would love an array more akin to Durable Objects with Alarms
  /// (So I can set more or less alarms based on if a server is currently running)
  /// Also, instead of having a config file with crons, I put them in the code
  crons: ["* * * * *"],
  async scheduled(event, env, ctx) {
    if (env.DIGITAL_OCEAN_TOKEN == null) {
      throw new Error(`DIGITAL_OCEAN_TOKEN is required`);
    }

    let minecraft_droplet = new MinecraftDroplet(env.DIGITAL_OCEAN_TOKEN);

    type Status =
      | { status: "offline" }
      | { status: "booting"; since: Date }
      | { status: "online" }
      | { status: "empty"; since: Date };
    /// Not sure how to make this nicely with typescript so going ad-hoc
    let set_status = async (status: Status) => {
      await ctx.storage.put("status", status);
    };
    let previous_status: Status = (await ctx.storage.get("status")) ?? {
      status: "offline",
    };

    /// TODO track if the droplet is online for under 50 minutes (or k * 60 + 50),
    /// .... because digital ocean charges per hour, so we don't have to remove if there is chance people will join
    let status = await minecraft_droplet.ping();

    if (status.status === "offline") {
      console.log(chalk.green(`Server not running, nothing to do`));
      await set_status({ status: "offline" });
    } else if (status.status === "booting") {
      if (previous_status.status === "booting") {
        let seconds_booting =
          (Date.now() - previous_status.since.getTime()) / 1000;
        if (seconds_booting > 5 * 60) {
          // prettier-ignore
          console.log(chalk.red(`Has been booting for 5 minutes, remove the droplet`));
          await minecraft_droplet.shutdown_and_destroy();
          console.log(chalk.green(`Droplet removed`));
        } else {
          // prettier-ignore
          console.log(chalk.yellow(`Server has been booting for ${seconds_booting} seconds`));
        }
      } else {
        // prettier-ignore
        console.log(chalk.yellow(`Server just started booting`));
        await set_status({ status: "booting", since: new Date() });
      }
    } else if (status.status === "online") {
      if (status.ping.players.online === 0) {
        if (previous_status.status === "empty") {
          let seconds_empty =
            (Date.now() - previous_status.since.getTime()) / 1000;

          if (seconds_empty > 20 * 60) {
            // prettier-ignore
            console.log(chalk.red(`Has been empty for 20 minutes, remove the droplet`));
            await minecraft_droplet.shutdown_and_destroy();
            console.log(chalk.green(`Droplet removed`));
          } else {
            // prettier-ignore
            console.log(chalk.yellow(`Server has been empty for ${seconds_empty} seconds`));
          }
        } else {
          // prettier-ignore
          console.log(chalk.yellow(`Server is online, just turned empty`));
          await set_status({ status: "empty", since: new Date() });
        }
      } else {
        // prettier-ignore
        console.log(chalk.green(`Server is online and people are online`));
        await set_status({ status: "online" });
      }
    } else {
      // prettier-ignore
      // @ts-expect-error
      throw new Error(`Unknown droplet status: ${status.status}`);
    }
  },
} satisfies App;
