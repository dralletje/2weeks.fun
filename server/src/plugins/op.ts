import { PlayPackets } from "../minecraft-protocol.ts";
import { c, command } from "../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../PluginInfrastructure/Plugin_v1.ts";

export default function op_plugin({
  send_packet,
  player,
}: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/op ${c.word("Level")}`,
        handle: async ([level]) => {
          send_packet(
            PlayPackets.clientbound.entity_event.write({
              entity_id: player.entity_id,
              event:
                level === "0"
                  ? 24
                  : level === "1"
                    ? 25
                    : level === "2"
                      ? 26
                      : level === "3"
                        ? 27
                        : 28,
            })
          );
        },
      }),
    ],
  };
}
