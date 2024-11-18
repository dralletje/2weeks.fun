import { PlayPackets } from "../minecraft-protocol.ts";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { interval } from "../utils/interval.ts";

let async = async (async) => async();

export let keepalive_driver = ({
  minecraft_socket,
  signal,
}: {
  minecraft_socket: MinecraftPlaySocket;
  signal: AbortSignal;
}) => {
  let last_keep_alive = BigInt(Date.now());

  async(async () => {
    for await (let _ of interval(5_000, { signal })) {
      last_keep_alive = BigInt(Date.now());
      minecraft_socket.send(
        PlayPackets.clientbound.keep_alive.write({ id: last_keep_alive })
      );
    }
  });

  minecraft_socket.on_packet["minecraft:keep_alive"].on(
    (packet) => {
      let { id } = PlayPackets.serverbound.keep_alive.read(packet);
      if (id !== last_keep_alive) {
        /// Not yet sure how to close the server but we'll figure it out
        // server_closed_controller.abort();
      }
    },
    { signal: signal }
  );
};
