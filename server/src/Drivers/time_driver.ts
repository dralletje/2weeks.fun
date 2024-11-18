import { PlayPackets } from "../minecraft-protocol.ts";
import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type AnySignal, effectWithSignal } from "../signals.ts";
import { modulo_cycle } from "../utils/modulo_cycle.ts";

export let time_driver = ({
  time$,
  minecraft_socket,
  signal,
}: {
  time$: AnySignal<{ time: bigint; locked: boolean }>;
  minecraft_socket: MinecraftPlaySocket;
  signal: AbortSignal;
}) => {
  effectWithSignal(signal, async () => {
    let { time, locked } = time$.get();
    minecraft_socket.send(
      PlayPackets.clientbound.set_time.write({
        world_age: 0n,
        time: modulo_cycle(time, 24000n) * (locked ? -1n : 1n),
      })
    );
  });
};
