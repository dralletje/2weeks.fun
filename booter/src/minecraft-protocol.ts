import { packets } from "@2weeks/minecraft-data";
import { bytes, mcp, wrap } from "./protocol.ts";

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
