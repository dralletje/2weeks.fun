import packets from "./packets.json" with { type: "json" };

export type ConnectionState =
  | "handshake"
  | "status"
  | "login"
  | "play"
  | "configuration";
export type ConnectionDirection = "serverbound" | "clientbound";

export { packets };

export let find_packet_name = ({
  id,
  state,
  direction,
}: {
  id: number;
  state: ConnectionState;
  direction: ConnectionDirection;
}) => {
  if (state === "handshake") {
    if (direction === "clientbound") {
      throw new Error("Handshake packets are only serverbound");
    }
    let name = Object.entries(packets.handshake.serverbound).find(
      ([name, packet]) => packet.protocol_id === id
    )?.[0];
    if (name == null) {
      throw new Error(`No handshake packet with id ${id}`);
    }
    return name;
  } else {
    let state_packets = packets[state][direction];
    let name = Object.entries(state_packets).find(
      ([name, packet]) => packet.protocol_id === id
    )?.[0];
    if (name == null) {
      throw new Error(`No ${state} ${direction} packet with id ${id}`);
    }
    return name;
  }
};
