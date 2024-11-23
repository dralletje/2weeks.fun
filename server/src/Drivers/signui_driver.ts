import { type MinecraftPlaySocket } from "../MinecraftPlaySocket.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { PlayPackets } from "../minecraft-protocol.ts";
import { type Position } from "../PluginInfrastructure/MinecraftTypes.ts";

type SignText = [string, string, string, string];

export type SignuiDriverOutput = {
  open(position: Position, front_or_back: "front" | "back"): Promise<SignText>;
};

type Resolvers<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

export let makeSignuiDriver = ({
  minecraft_socket,
}: {
  minecraft_socket: MinecraftPlaySocket;
}): Driver_v1<void, SignuiDriverOutput> => {
  return ({ input$, signal, effect }) => {
    let open_location: {
      is_front_text: boolean;
      position: Position;
      resolvers: Resolvers<SignText>;
    } | null = null;

    minecraft_socket.on_packet["minecraft:sign_update"].on(
      (packet) => {
        let { is_front_text, location, line1, line2, line3, line4 } =
          PlayPackets.serverbound.update_sign.read(packet);

        if (open_location === null) {
          throw new Error("Signui not open");
        }

        let { position, resolvers } = open_location;
        /// TODO? Make sure position and is_front_text match??

        open_location = null;
        resolvers.resolve([line1, line2, line3, line4]);
      },
      { signal }
    );

    return {
      open: async (position: Position, front_or_back: "front" | "back") => {
        if (open_location !== null) {
          throw new Error("Signui already open");
        }

        let resolvers: Resolvers<SignText> & { promise: Promise<SignText> } =
          // @ts-ignore
          Promise.withResolvers();

        open_location = {
          is_front_text: front_or_back === "front",
          position: position,
          resolvers: resolvers,
        };

        minecraft_socket.send(
          PlayPackets.clientbound.open_sign_editor.write({
            location: position,
            is_front_text: front_or_back === "front",
          })
        );

        return await resolvers.promise;
      },
    };
  };
};
