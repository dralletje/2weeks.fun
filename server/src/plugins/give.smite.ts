import { chat } from "../utils/chat.ts";
import { c, command } from "../PluginInfrastructure/Commands_v1.ts";
import { type Plugin_v1 } from "../PluginInfrastructure/Plugin_v1.ts";

export default function smite_plugin(): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/give dral:smite`,
        handle: ([], { player }) => {
          player.send(chat.green("SMITE!"));

          player.hotbar$.set(
            player.hotbar$
              .get()
              .toSpliced(player.selected_hotbar_slot$.get(), 1, {
                item: "minecraft:diamond_sword",
                count: 1,
                properties: {
                  rarity: "epic",
                  lore: ["Excalibur"],
                  damage: 40,
                  max_damage: 100,
                  custom_name: "EXCALIBUR!",
                },
              }) as any
          );

          player.send(chat.green(`* Gave you smite!!!`));
        },
      }),
    ],
  };
}
