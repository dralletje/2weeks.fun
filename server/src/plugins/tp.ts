import { chat } from "../utils/chat.ts";
import {
  c,
  command,
  CommandError,
} from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";
import { error } from "../utils/error.ts";

export default function tp_plugin({ world }: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/tp ${c.vec3("destination")}`,
        handle: ([destination], { player }) => {
          player.teleport({
            ...destination,
            yaw: player.position.yaw,
            pitch: player.position.pitch,
          });
          // prettier-ignore
          player.send(chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported to ${destination.x.toFixed(2)}, ${destination.y.toFixed(2)}, ${destination.z.toFixed(2)}`)}`);
        },
      }),
      command({
        command: c.command`/tp ${c.vec3("Coordinates")} ${c.rotation("rotation")}`,
        handle: ([destination, rotation], { player }) => {
          player.teleport({
            ...destination,
            yaw: rotation.yaw,
            pitch: rotation.pitch,
          });
          // prettier-ignore
          player.send(chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported to ${destination.x.toFixed(2)}, ${destination.y.toFixed(2)}, ${destination.z.toFixed(2)}`)} (${(rotation.yaw / (2 * Math.PI) * 360).toFixed(2)}°, ${(rotation.pitch / (2 * Math.PI) * 360).toFixed(2)}°)`);
        },
      }),
      command({
        command: c.command`/tp ${c.vec3("destination")}`,
        handle: ([destination], { player }) => {
          player.teleport({
            ...destination,
            yaw: player.position.yaw,
            pitch: player.position.pitch,
          });
          // prettier-ignore
          player.send(chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported to ${destination.x.toFixed(2)}, ${destination.y.toFixed(2)}, ${destination.z.toFixed(2)}`)}`);
        },
      }),

      command({
        command: c.command`/tp ${c.player("Player to teleport")} to me`,
        handle: ([player_to_teleport], { player }) => {
          if (!("uuid" in player_to_teleport)) {
            throw new CommandError(
              chat`Player ${player_to_teleport.name} not found`
            );
          }
          let other_player =
            world.players.get().get(player_to_teleport.uuid) ??
            error(new CommandError(`Player ${player_to_teleport} not found`));

          other_player.teleport(player.position);
          // prettier-ignore
          player.send(chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported ${player_to_teleport.name} to you`)}`);
        },
      }),
      command({
        command: c.command`/tp ${c.player("Player")}`,
        handle: ([destination], { player }) => {
          if (!("uuid" in destination)) {
            throw new CommandError(chat`Player ${destination.name} not found`);
          }

          let other_player =
            world.players.get().get(destination.uuid) ??
            error(new CommandError(`Player ${destination} not found`));

          player.teleport(other_player.position);
          // prettier-ignore
          player.send(chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported to`)} ${chat.yellow(destination.name)}`);
        },
      }),
    ],
  };
}
