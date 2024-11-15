import { WithVarintLengthTransformStream } from "@2weeks/binary-protocol/WithVarintLengthTransformStream";
import { connect, type SocketAddress } from "@2weeks/socket";
import { HandshakePackets, StatusPackets } from "./minecraft-protocol.ts";

export let minecraft_ping = async ({
  hostname,
  port,
  signal,
}: SocketAddress & {
  signal?: AbortSignal;
}) => {
  let socket = connect(
    { hostname: hostname, port: port },
    { allowHalfOpen: false }
  );

  signal?.addEventListener("abort", () => {
    socket.close();
  });

  try {
    let writer = socket.writable.getWriter();
    let readable = socket.readable
      .pipeThrough(WithVarintLengthTransformStream())
      .getReader();

    /// TODO This should be done by socket.close()??
    signal?.addEventListener("abort", () => {
      readable.cancel();
      writer.close();
    });

    await writer.write(
      HandshakePackets.serverbound.intention.write({
        protocol_version: 767,
        host: hostname,
        port: port,
        next_state: "status",
      })
    );
    await writer.write(StatusPackets.serverbound.status_request.write({}));

    let packet = await readable.read();
    if (packet.done === true) {
      throw new Error("No response from server");
    }

    let { response } = StatusPackets.clientbound.status_response.read(
      packet.value
    );
    return response;
  } finally {
    /// Because Wrangler doesn't support `using socket = ...`
    socket[Symbol.dispose]?.();
  }
};
