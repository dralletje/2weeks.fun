import { type BasicPlayer } from "../PluginInfrastructure/BasicPlayer.ts";
import { type MinecraftPlaySocket } from "../protocol/MinecraftPlaySocket.ts";
import { PlayPackets } from "../protocol/minecraft-protocol.ts";
import chalk from "chalk";
import { chat } from "../utils/chat.ts";
import {
  type ServerSuggestion,
  type Command_v1,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import { type Driver_v1 } from "../PluginInfrastructure/Driver_v1.ts";
import { Signal } from "signal-polyfill";
import { flatten_command_node } from "./commands_driver/brigadier_helpers.ts";

let match_command = (
  command_string: string,
  commands: Array<Command_v1<any>>,
  context: { player: BasicPlayer; players: Map<string, bigint> }
) => {
  let best_match: {
    results: any;
    priority: number;
    command: Command_v1<any>;
  } | null = null;

  for (let command of commands) {
    let parsed = command.parse(command_string, context);
    if (parsed) {
      if (!best_match || best_match.priority < parsed.priority) {
        best_match = { ...parsed, command: command };
      }
    }
  }
  return best_match;
};

let match_command_to_suggest = (
  command_string: string,
  commands: Array<Command_v1<any>>,
  context: { player: BasicPlayer; players: Map<string, bigint> }
) => {
  let best_match: {
    args: any;
    priority: number;
    start: number;
    length: number;
    suggest: () => Array<ServerSuggestion>;
  } | null = null;

  for (let command of commands) {
    let parsed = command.suggest(command_string, context);
    if (parsed) {
      if (best_match == null || best_match.priority < parsed.priority) {
        best_match = parsed;
      }
    }
  }
  return best_match;
};

export let commands_driver = ({
  getContext,
  minecraft_socket,
  player,
}: {
  getContext: () => { player: BasicPlayer; players: Map<string, bigint> };
  minecraft_socket: MinecraftPlaySocket;
  player: BasicPlayer;
}): Driver_v1<Array<Command_v1<any>>> => {
  return ({ input$, effect, signal }) => {
    let commands$ = new Signal.Computed(() => {
      return input$.get().flat();
    });

    effect(() => {
      let commands = commands$.get();
      let x = flatten_command_node({
        type: "root",
        children: commands.map((command) => command.brigadier),
      });

      minecraft_socket.send(
        PlayPackets.clientbound.commands.write({
          nodes: x.nodes,
          root_index: x.root_index,
        })
      );
    });

    let execute_command = async (command: string, player: BasicPlayer) => {
      console.log(
        `${chalk.blue(`[PLAY]`)}`,
        `Chat command: ${chalk.green(command)}`
      );

      let context = getContext();
      let match = match_command(command, commands$.get(), context);

      if (match) {
        try {
          await match.command.execute(match.results, {
            player,
          });
        } catch (error: any) {
          if (error instanceof CommandError) {
            player.send(chat`${chat.red("* ")} ${chat.red(error.chat)}`);
          } else {
            console.log(
              `${chalk.red(`error in command`)} ${chalk.yellow(`"${command}"`)}`
            );
            console.log(chalk.dim.red(error.stack));
            player.send(
              chat`${chat.red("* Error in command:")} ${error.message}`
            );
          }
        }
      } else {
        player.send(
          chat`${chat.red("* Unknown command")} ${chat.yellow(command)}`
        );
      }
    };

    minecraft_socket.on_packet["minecraft:chat_command"].on(
      async (packet) => {
        let { command: _command } =
          PlayPackets.serverbound.chat_command.read(packet);
        let command = `/${_command}`;
        execute_command(command, player);
      },
      { signal: signal }
    );
    minecraft_socket.on_packet["minecraft:chat_command_signed"].on(
      async (packet) => {
        let { command: _command, ...options } =
          PlayPackets.serverbound.chat_command_signed.read(packet);
        let command = `/${_command}`;
        console.log(`${chalk.blue(`[PLAY]`)} Signed? Chat command: ${command}`);
        execute_command(command, player);
      },
      { signal: signal }
    );

    minecraft_socket.on_packet["minecraft:command_suggestion"].on(
      async (packet) => {
        let { id, text } =
          PlayPackets.serverbound.command_suggestions.read(packet);
        let command = text;

        // console.log(`${chalk.blue(`[PLAY]`)} Command suggestion: "${command}"`);

        let suggester = match_command_to_suggest(
          command,
          commands$.get(),
          getContext()
        );
        if (suggester) {
          let suggestions = suggester.suggest();
          let suggestions_packet =
            PlayPackets.clientbound.command_suggestions.write({
              id: id,
              start: suggester.start,
              length: suggester.length,
              matches: suggestions.map((suggestion) => ({
                text: suggestion.text,
                tooltip: suggestion.tooltip ?? null,
              })),
            });
          minecraft_socket.send(suggestions_packet);
        }
      },
      { signal: signal }
    );
  };
};
