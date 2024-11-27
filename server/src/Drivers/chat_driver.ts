import { isEqual } from "lodash-es";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import {
  chat_to_text,
  type TextComponent,
} from "../protocol/text-component.ts";
import { SingleEventEmitter } from "../packages/single-event-emitter.ts";
import { UUID } from "../utils/UUID.ts";
import { Signal } from "signal-polyfill";

export type ChatDriverOutput = {
  chat: (
    message: TextComponent | string,
    sender: { uuid: bigint; name: string }
  ) => void;
  send: (message: TextComponent | string) => void;
  statusbar: (message: TextComponent | string) => void;
};

export function makeChatDriver({
  minecraft_socket,
  uuid,
  username,
}: {
  minecraft_socket: MinecraftPlaySocket;
  uuid: UUID;
  username: string;
}): Driver_v1<{ completions?: Array<string> }, ChatDriverOutput> {
  return ({ effect, input$, signal }) => {
    let client_completions: Array<string> = [];
    let server_completions$ = new Signal.Computed(() => {
      return input$.get().flatMap((x) => x.completions ?? []);
    });
    effect(() => {
      /// There is also action: "add" and action: "remove" if this
      /// ever becomes a bottleneck 😂
      let server_completions = server_completions$.get();
      if (!isEqual(server_completions, client_completions)) {
        minecraft_socket.send(
          PlayPackets.clientbound.custom_chat_completions.write({
            action: "set",
            entries: server_completions,
          })
        );
      }
      client_completions = server_completions;
    });

    let chat_stream = new SingleEventEmitter<{
      message: TextComponent | string;
      sender: { uuid: bigint; name: string };
    }>();
    let system_stream = new SingleEventEmitter<{
      message: TextComponent | string;
    }>();

    minecraft_socket.on_packet["minecraft:chat"].on(
      async (packet) => {
        let chat = PlayPackets.serverbound.chat.read(packet);
        chat_stream.emit({
          message: chat.message,
          sender: {
            uuid: uuid.toBigInt(),
            name: username,
          },
        });
      },
      { signal: signal }
    );

    chat_stream.on(
      ({ message, sender }) => {
        minecraft_socket.send(
          PlayPackets.clientbound.player_chat.write({
            header: {
              index: 0,
              sender: sender.uuid,
              signature: null,
            },
            body: {
              message: chat_to_text(message),
              salt: 0n,
              timestamp: BigInt(Date.now()),
            },
            previous_messages: [],
            formatting: {
              chat_type: 1,
              sender_name: `§9${sender.name}`,
              target_name: null,
            },
            other: {
              content: `${message}`,
            },
          })
        );

        // minecraft_socket.send(
        //   PlayPackets.clientbound.system_chat.write({
        //     message: chat`${chat.dark_purple(sender.name)}: ${message}`,
        //     is_action_bar: false,
        //   })
        // );
      },
      { signal: signal }
    );
    system_stream.on(
      ({ message }) => {
        minecraft_socket.send(
          PlayPackets.clientbound.system_chat.write({
            message: message,
            is_action_bar: false,
          })
        );
      },
      { signal: signal }
    );

    return {
      chat: (message, sender) => {
        chat_stream.emit({ message, sender });
      },
      send: (message) => {
        system_stream.emit({ message });
      },
      statusbar: (message) => {
        minecraft_socket.send(
          PlayPackets.clientbound.set_action_bar_text.write({
            text: message,
          })
        );
      },
    };
  };
}
