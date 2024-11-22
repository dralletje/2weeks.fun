import { connect } from "@2weeks/socket";
import { WithVarintLengthTransformStream } from "@2weeks/binary-protocol/WithVarintLengthTransformStream";
import { encode_with_varint_length } from "@2weeks/binary-protocol/with_varint_length";
import { decode_varint, encode_varint } from "@2weeks/binary-protocol/varint";
import chalk from "chalk";
import { chunk } from "lodash-es";
import {
  consume,
  decode_combined,
  decode_identity,
  encode_combined,
  type Protocol,
} from "@2weeks/binary-protocol/Protocol";
import fs from "fs/promises";
import { type App } from "@2weeks/tcp-workers";
import { decode_string } from "@2weeks/binary-protocol/string";
import { decode_uint16 } from "@2weeks/binary-protocol/bytes";
import { find_packet_name, packets } from "@2weeks/minecraft-data";

let async = async (async) => async();

let decode_assert_equals = <Input, const Output extends Input>(
  protocol: Protocol<Input>,
  equals: Output,
  message = `Expected ${equals}`
): Protocol<Output> => {
  return (buffer) => {
    let [value, offset] = protocol(buffer);
    if (value !== equals) {
      throw new Error(`${message} (got ${value})`);
    }
    return [value as Output, offset];
  };
};
let isPacketID = <const N extends number>(id: N) =>
  decode_assert_equals(decode_varint, id, `Expected packet ID = ${id}`);

let read_required = async <T>(reader: ReadableStreamDefaultReader<T>) => {
  let { value, done } = await reader.read();
  if (done || !value) {
    throw new Error(`Connection closed`);
  }
  return value;
};

let decode_handshake = (buffer: Uint8Array) => {
  let [packet_id, [protocol_version, host, port, next_state]] = consume(
    decode_combined([
      isPacketID(0),
      decode_combined([
        decode_varint,
        decode_string,
        decode_uint16,
        decode_varint,
      ]),
    ])
  )(buffer);

  return {
    protocol_version,
    host,
    port,
    next_state,
  };
};

let uint8array_as_hex = (buffer: Uint8Array) => {
  return chunk(
    Array.from(buffer).map((byte) => byte.toString(16).padStart(2, "0")),
    20
  )
    .map((x) => x.join(" "))
    .join("\n");
};

let unzlib = async (buffer: Uint8Array) => {
  let ds = new DecompressionStream("deflate");
  let writer = ds.writable.getWriter();
  writer.write(buffer);
  writer.close();

  let result = new Uint8Array();
  for await (let chunk of ds.readable) {
    result = new Uint8Array([...result, ...chunk]);
  }

  return result;
};

let packet_format = consume(decode_combined([decode_varint, decode_identity]));
let format_packet_id = (packet_id: number) => {
  return `0x${packet_id.toString(16).padStart(2, "0")}`;
};

/// Ports:
/// 25561: Proxy to Notchian server
/// 25562: Proxy to Node server
/// 25563: Proxy to papermc
/// 25566: Notchian server
/// 25565: Node server

export default {
  ports: [25561, 25562, 25563],
  async connect({ port, socket: client }) {
    try {
      console.log("");
      console.log(chalk.bgBlue(" CLIENT CONNECTED "));

      let SERVER =
        port === 25561 ? "Notchian" : port === 25562 ? "Node" : "Papermc";

      let client_writer = client.writable.getWriter();

      let server = connect(
        SERVER === "Notchian"
          ? "localhost:25566"
          : SERVER === "node"
            ? "localhost:25565"
            : "209.38.100.90:25565"
      );
      let server_writer = server.writable.getWriter();

      let compression_enabled = false;
      let decompress = async (buffer: Uint8Array) => {
        if (compression_enabled) {
          let [size, offset] = decode_varint(buffer);
          let payload = buffer.slice(offset);

          if (size === 0) {
            return payload;
          } else {
            return await unzlib(payload);
          }
        } else {
          return buffer;
        }
      };

      let connection_state = "handshake" as
        | "handshake"
        | "status"
        | "login"
        | "configuration"
        | "play";

      let history = [] as Array<{
        direction: "clientbound" | "serverbound";
        packet_id: number;
        packet_name: string;
        packet: Uint8Array;
      }>;

      let _1 = async(async () => {
        let first_message = false;
        for await (let packet of server.readable.pipeThrough(
          WithVarintLengthTransformStream()
        )) {
          let decompressed = await decompress(packet);
          let [packet_id, payload] = packet_format(decompressed);

          let packet_name = find_packet_name({
            id: packet_id,
            state: connection_state,
            direction: "clientbound",
          });

          /// Now we are going to filter some packets
          if (
            /// Configuration
            // packet_name === "minecraft:custom_payload" ||
            // packet_name === "minecraft:update_enabled_features" ||
            // /// Play (I hope)
            // packet_name === "minecraft:commands" ||
            // packet_name === "minecraft:move_player_pos" ||
            // packet_name === "minecraft:initialize_border" ||
            // packet_name === "minecraft:set_carried_item" ||
            // packet_name === "minecraft:player_abilities" ||
            // packet_name === "minecraft:change_difficulty" ||
            // packet_name === "minecraft:move_player_pos_rot" ||
            // packet_name === "minecraft:update_recipes" ||
            // packet_name === "minecraft:player_info_update" ||
            // packet_name === "minecraft:set_time" ||
            // packet_name === "minecraft:set_default_spawn_position" ||
            // packet_name === "minecraft:entity_event" ||
            // packet_name === "minecraft:recipe" ||
            // packet_name === "minecraft:server_data" ||
            // packet_name === "minecraft:player_position" ||
            packet_name === "minecraft:move_entity_pos" ||
            packet_name === "minecraft:rotate_head" ||
            packet_name === "minecraft:move_entity_pos_rot" ||
            packet_name === "minecraft:level_particles"
          ) {
            continue;
          }

          // if (
          //   packet_name === "minecraft:registry_data" ||
          //   packet_name === "minecraft:update_tags"
          // ) {
          //   continue;
          // }

          console.log(
            chalk.bgRed(` S -> C `),
            chalk.green(`[${connection_state}]`),
            format_packet_id(packet_id),
            packet_name != null ? chalk.magenta(`[${packet_name}]`) : ""
          );
          console.log(print_hex(payload));

          if (packet_name === "minecraft:login") {
            console.log(chalk.green(uint8array_as_hex(payload)));
          }

          if (connection_state === "handshake") {
            /// Nothing
          } else if (connection_state === "status") {
            /// Nothing
          } else if (connection_state === "login") {
            /// Nothing
          } else if (connection_state === "configuration") {
            /// Nothing
          } else if (connection_state === "play") {
            /// Nothing
          } else {
            throw new Error(`Unknown connection state: ${connection_state}`);
          }

          // if (packet_id === 0x07 || packet_id === 0x0d) {
          //   buffer_of_0x07s.push(
          //     encode_with_varint_length(
          //       encode_combined([encode_varint(packet_id), payload])
          //     )
          //   );
          // }
          // if (packet_id === 0x38) {
          //   await fs.writeFile(
          //     "./output/buffer_of_0x07s.bin",
          //     Buffer.concat(buffer_of_0x07s)
          //   );
          //   // throw new Error("Got far enough");
          // }

          // if (packet_id === 0x27) {
          //   await fs.writeFile("./output/0x27.hex", uint8array_as_hex(payload));

          //   /// Wait indefinitely
          //   // await new Promise(() => {});
          // }

          history.push({
            direction: "clientbound",
            packet_id: packet_id,
            packet_name: packet_name,
            packet: encode_with_varint_length(packet),
          });
          await client_writer.write(encode_with_varint_length(packet));

          // if (packet_name === "minecraft:game_event") {
          //   if (payload[0] === 0x0d) {
          //     /// Wait indefinitely
          //     await fs.writeFile(
          //       `./output/${new Date().toISOString()}.json`,
          //       JSON.stringify(
          //         history.map((x) => {
          //           return {
          //             direction: x.direction,
          //             packet_id: x.packet_id,
          //             packet_name: x.packet_name,
          //             packet: uint8array_as_hex(x.packet).replaceAll("\n", ""),
          //           };
          //         })
          //       )
          //     );
          //     await new Promise(() => {});
          //   }
          // }

          if (first_message === false) {
            first_message = true;

            if (packet[0] === 0x03) {
              compression_enabled = true;
            }
          }
        }
      });

      let _2 = async(async () => {
        for await (let packet of client.readable.pipeThrough(
          WithVarintLengthTransformStream()
        )) {
          let decompressed = await decompress(packet);
          let [packet_id, payload] = packet_format(decompressed);

          let packet_name = find_packet_name({
            id: packet_id,
            state: connection_state,
            direction: "serverbound",
          });

          if (packet_name !== "minecraft:move_player_pos") {
            console.log(
              chalk.bgBlue(` C -> S `),
              chalk.green(`[${connection_state}]`),
              format_packet_id(packet_id),
              packet_name != null ? chalk.magenta(`[${packet_name}]`) : ""
            );
            console.log(print_hex(payload));
          }

          if (connection_state === "handshake") {
            let handshake = decode_handshake(decompressed);
            // console.log(`handshake:`, handshake);
            connection_state = handshake.next_state === 1 ? "status" : "login";
          } else if (connection_state === "status") {
            /// Nothing
          } else if (connection_state === "login") {
            if (packet_name === "minecraft:login_acknowledged") {
              connection_state = "configuration";
            }
          } else if (connection_state === "configuration") {
            if (packet_name === "minecraft:finish_configuration") {
              connection_state = "play";
            }
          } else if (connection_state === "play") {
            /// Nothing
          } else {
            throw new Error(`Unknown connection state: ${connection_state}`);
          }

          history.push({
            direction: "serverbound",
            packet_id: packet_id,
            packet_name: packet_name,
            packet: encode_with_varint_length(packet),
          });
          await server_writer.write(encode_with_varint_length(packet));
        }
      });

      await Promise.race([_1, _2, client.closed, server.closed]);
      await client.close();
      await server.close();

      if (connection_state === "play") {
        await fs.writeFile(
          `./output/${new Date().toISOString()}-${SERVER}.json`,
          JSON.stringify(
            history.map((x) => {
              return {
                direction: x.direction,
                packet_id: x.packet_id,
                packet_name: x.packet_name,
                packet: uint8array_as_hex(x.packet).replaceAll("\n", ""),
              };
            })
          )
        );
      }
    } finally {
      await client.close();
    }
  },
} satisfies App;

let print_hex = (payload: Uint8Array) => {
  if (payload.length > 100) {
    return `${chalk.gray(uint8array_as_hex(payload.slice(0, 78)))} .....`;
  } else {
    return chalk.gray(uint8array_as_hex(payload));
  }
};
