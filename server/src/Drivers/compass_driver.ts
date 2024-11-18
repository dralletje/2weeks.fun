import { PlayPackets } from "../minecraft-protocol.ts";
import { MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";

export let compass_driver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<{ x: number; y: number; z: number }> => {
  return ({ effect, input$: compass$, signal }) => {
    /// Compass position
    effect(async () => {
      let compass = compass$.get();
      minecraft_socket.send(
        PlayPackets.clientbound.set_default_spawn_position.write({
          location: {
            x: compass.x,
            y: compass.y,
            z: compass.z,
          },
          angle: 0,
        })
      );
    });
  };
};
