import { chat } from "../chat.ts";
import { Command, p, type Plugin_v1 } from "../Plugins/Plugin_v1.ts";

export default function tp_plugin(): Plugin_v1 {
  return {
    commands: [
      Command({
        command: p.command`/tp ${p.vec3("destination")}`,
        handle: ([destination], { player }) => {
          player.teleport({
            ...destination,
            yaw: player.position.yaw,
            pitch: player.position.pitch,
          });
          // prettier-ignore
          let x = chat`${chat.dark_purple("* ")} ${chat.gray(`Teleported to ${destination.x.toFixed(2)}, ${destination.y.toFixed(2)}, ${destination.z.toFixed(2)}`)}`
          console.log(`x:`, x);
          player.send(x);
        },
      }),
    ],
  };
}
