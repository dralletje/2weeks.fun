import { find_packet_name } from "@2weeks/minecraft-data";
import { type App } from "@2weeks/tcp-workers";
import chalk from "chalk";
import bot_to_notchian from "../data/bot-to-notchian.json" with { type: "json" };
import { mcp } from "./protocol/mcp.ts";
import {
  ConfigurationPackets,
  HandshakePackets,
  LoginPackets,
  StatusPackets,
} from "./protocol/minecraft-protocol.ts";
import { type DuplexStream } from "./MinecraftPlaySocket.ts";
import { Mojang } from "./packages/Mojang.ts";
import { combined, native } from "./protocol/protocol.ts";
import { UUID } from "./utils/UUID.ts";
import { WithVarintLengthTransformStream } from "./WithVarintLengthTransformStream.ts";

// @ts-ignore
import buffer_of_0x07s from "../data/buffer_of_0x07s.bin" with { type: "binary" };
import { hex_to_uint8array } from "./utils/hex-x-uint8array.ts";
import { play } from "./play.ts";

let with_packet_length = native.with_byte_length(mcp.varint, native.uint8array);

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

let state_configuration = async ({
  socket: { readable, writable },
}: {
  socket: DuplexStream;
}) => {
  let writer = writable.getWriter();
  try {
    await writer.write(
      ConfigurationPackets.clientbound.select_known_packs.write({
        packs: [{ namespace: "minecraft", id: "core", version: "1.21.1" }],
      })
    );

    for await (let packet of readable.values({ preventCancel: true })) {
      let [{ packet_id }] = packet_id_protocol.decode(packet);
      let packet_name = find_packet_name({
        direction: "serverbound",
        id: packet_id,
        state: "configuration",
      });

      if (packet_name === "minecraft:client_information") {
        let stuff =
          ConfigurationPackets.serverbound.client_information.read(packet);
        console.log(
          `${chalk.magenta(`[CONFIGURATION]`)} ${chalk.green(`minecraft:client_information`)}`
          // stuff
        );
        /// Also ignoring!
      } else if (packet_name === "minecraft:custom_payload") {
        let { channel, data } =
          ConfigurationPackets.serverbound.custom_payload.read(packet);

        console.log(
          `${chalk.magenta(`[CONFIGURATION]`)} ${chalk.green(`minecraft:custom_payload`)}`,
          channel
        );
        /// Ignoring!
      } else if (packet_name === "minecraft:finish_configuration") {
        let _ =
          ConfigurationPackets.serverbound.finish_configuration.read(packet);

        console.log(
          `${chalk.magenta(`[CONFIGURATION]`)} ${chalk.green(`minecraft:finish_configuration`)}`
        );
        return;
      } else if (packet_name === "minecraft:select_known_packs") {
        let { packs } =
          ConfigurationPackets.serverbound.select_known_packs.read(packet);

        if (packs.length === 0) {
          let registry_data = bot_to_notchian
            .filter((x) => x.packet_name === "minecraft:registry_data")
            .map((x) => ({
              packet_name: x.packet_name,
              data: hex_to_uint8array(x.packet),
            }));
          for (let registry_data_packet of registry_data) {
            await writer.write(
              with_packet_length.encode(registry_data_packet.data)
            );
          }
        } else {
          /// The default configuration packets which I got from the Notchian server
          await writer.write(buffer_of_0x07s);
          await writer.write(
            ConfigurationPackets.clientbound.registry_data.write({
              registry_id: "minecraft:dimension_type",
              entries: [
                {
                  identifier: "dral:chunky",
                  data: {
                    type: "compound",
                    value: [
                      {
                        type: "byte",
                        value: { name: "piglin_safe", value: 0 },
                      },
                      { type: "byte", value: { name: "natural", value: 1 } },
                      {
                        type: "float",
                        value: { name: "ambient_light", value: 0 },
                      },
                      {
                        type: "int",
                        value: {
                          name: "monster_spawn_block_light_limit",
                          value: 0,
                        },
                      },
                      {
                        type: "string",
                        value: {
                          name: "infiniburn",
                          value: "#minecraft:infiniburn_overworld",
                        },
                      },
                      {
                        type: "byte",
                        value: { name: "respawn_anchor_works", value: 0 },
                      },
                      {
                        type: "byte",
                        value: { name: "has_skylight", value: 1 },
                      },
                      { type: "byte", value: { name: "bed_works", value: 1 } },
                      {
                        type: "string",
                        value: {
                          name: "effects",
                          value: "minecraft:overworld",
                        },
                      },
                      { type: "byte", value: { name: "has_raids", value: 1 } },
                      {
                        type: "int",
                        value: { name: "logical_height", value: 16 },
                      },
                      {
                        type: "double",
                        value: { name: "coordinate_scale", value: 1 },
                      },
                      {
                        type: "compound",
                        value: {
                          name: "monster_spawn_light_level",
                          value: [
                            {
                              type: "int",
                              value: { name: "min_inclusive", value: 0 },
                            },
                            {
                              type: "int",
                              value: { name: "max_inclusive", value: 7 },
                            },
                            {
                              type: "string",
                              value: {
                                name: "type",
                                value: "minecraft:uniform",
                              },
                            },
                          ],
                        },
                      },
                      // { type: "int", value: { name: "min_y", value: -64 } },
                      { type: "int", value: { name: "min_y", value: 0 } },
                      { type: "int", value: { name: "height", value: 16 } },
                      // { type: "int", value: { name: "height", value: 16 } },

                      { type: "byte", value: { name: "ultrawarm", value: 0 } },
                      {
                        type: "byte",
                        value: { name: "has_ceiling", value: 0 },
                      },
                    ],
                  },
                },
              ],
            })
          );
        }

        await writer.write(
          ConfigurationPackets.clientbound.finish_configuration.write({})
        );
      } else {
        console.log(
          `${chalk.magenta(`[CONFIGURATION]`)} ${chalk.red(packet_name)} UNHANDLED`
        );
      }
    }

    throw new Error("Connection closed in configuration");
  } finally {
    writer.releaseLock();
  }
};

//////////////////////////////////////////////////

// try {
//   let with_packet_length = native.with_byte_length(
//     mcp.varint,
//     native.uint8array
//   );
//   let offset = 0;
//   while (true) {
//     let [packet_1, length_1] = with_packet_length.decode(
//       buffer_of_0x07s.subarray(offset)
//     );
//     let b = ConfigurationPackets.clientbound.registry_data.read(
//       with_packet_length.encode(packet_1)
//     );
//     offset += length_1;
//     console.log(`b:`, b);
//   }
// } catch (error) {}

//////////////////////////////////////////////////

// import util from "util";
// let registry_data = bot_to_notchian
//   .filter((x) => x.packet_name === "minecraft:registry_data")
//   .map((x) => ({
//     packet_name: x.packet_name,
//     data: hex_to_uint8array(x.packet),
//   }));
// for (let registry_data_packet of registry_data) {
//   let b = ConfigurationPackets.clientbound.registry_data.read(
//     with_packet_length.encode(registry_data_packet.data)
//   );
//   if (b.registry_id === "minecraft:dimension_type") {
//     console.log(`b:`, util.inspect(b, { depth: 10, colors: true }));
//   }
// }

//////////////////////////////////////////////////

let packet_id_protocol = native.with_byte_length(
  mcp.varint,
  combined([
    { name: "packet_id", protocol: mcp.varint },
    { name: "payload", protocol: native.uint8array },
  ])
);

let state_STATUS = async ({
  socket: { readable, writable },
}: {
  socket: DuplexStream;
}) => {
  let writer = writable.getWriter();

  let VERSION = {
    name: "1.21.1",
    protocol: 767,
  };

  for await (let packet of readable) {
    let [{ packet_id }] = packet_id_protocol.decode(packet);

    if (packet_id === StatusPackets.serverbound.status_request.id) {
      /// STATUS
      let _ = StatusPackets.serverbound.status_request.read(packet);
      await writer.write(
        StatusPackets.clientbound.status_response.write({
          response: {
            version: VERSION,
            players: {
              max: 20,
              online: 0,
              sample: [],
            },
            description: "Hello, world!",
          },
        })
      );
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

export default {
  ports: [25565],
  async connect({ port, socket }, env) {
    let packet_readable = socket.readable.pipeThrough(
      WithVarintLengthTransformStream()
    );

    let reader = packet_readable.getReader();
    let writer = socket.writable.getWriter();

    let handshake = HandshakePackets.serverbound.intention.read(
      await read_required(reader)
    );

    console.log(chalk.bgGreen("  "), chalk.green("Client connecting1"));
    console.log(chalk.bgGreen("  "), chalk.green("host"), handshake.host);
    console.log(chalk.bgGreen("  "), chalk.green("port"), handshake.port);
    console.log(
      chalk.bgGreen("  "),
      chalk.green("next_state"),
      handshake.next_state
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
      });
    } else if (handshake.next_state === "login") {
      let { name, uuid: offline_uuid_bigint } =
        LoginPackets.serverbound.hello.read(await read_required(reader));

      let offline_uuid = UUID.from_bigint(offline_uuid_bigint);
      let mojang_uuid = await Mojang.get_uuid(name);
      let texture = mojang_uuid ? await Mojang.get_texture(mojang_uuid) : null;

      // let uuid = mojang_uuid
      //   ? UUID.from_compact(mojang_uuid)
      //   : offline_uuid;

      let uuid = offline_uuid;

      // console.log(`texture:`, atob(texture));

      await writer.write(
        LoginPackets.clientbound.game_profile.write({
          name: name,
          uuid: uuid.toBigInt(),
          properties: texture
            ? [
                {
                  name: "textures",
                  value: texture.value,
                  signature: texture.signature,
                },
              ]
            : [],
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
      });
      await play({
        socket: {
          readable: packet_readable,
          writable: socket.writable,
        },
        uuid: uuid,
        username: name,
        texture: texture,
      });
    } else if (handshake.next_state === "transfer") {
      throw new Error("Unexpected next_state 3 (transer)");
    } else {
      throw new Error(`Unknown next_state: ${handshake.next_state}`);
    }
  },
} satisfies App;
