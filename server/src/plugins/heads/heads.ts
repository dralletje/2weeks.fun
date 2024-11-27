import { Signal } from "signal-polyfill";
import {
  c,
  command,
  CommandArgument,
} from "../../PluginInfrastructure/Commands_v1.ts";
import {
  type Plugin_v1_Args,
  type Plugin_v1,
} from "../../PluginInfrastructure/Plugin_v1.ts";
import { chat } from "../../utils/chat.ts";
import { type Slot } from "../../PluginInfrastructure/BasicPlayer.ts";
import { search_heads } from "./heads_database.ts";
import { type OpenWindowApp } from "../../Drivers/windows_v1_driver.ts";

let base64 = (name: string) => {
  return new CommandArgument({
    brigadier_type: { type: "brigadier:string", behavior: "SINGLE_WORD" },
    name: name,
    parse(path, context) {
      let [match, base64] = path.match(/^([^ ]+)( |$)/) ?? [];
      if (match == null) {
        return null;
      }

      try {
        /// Just making sure it decoded
        let decoded = atob(base64);
        return [base64, match];
      } catch (error) {
        console.log(`error:`, error);
        return null;
      }
    },
    priority: 50,
  });
};

let render_categories: OpenWindowApp = ({ signal, on_action }) => {
  return new Signal.Computed(() => {
    return {
      title: "Categories",
      type: "minecraft:anvil",
      carried_item: null,
      inventory: [],
      survival_inventory: [],
    };
  });
};

export default function heads_plugin({
  windows_v1,
  player,
}: Plugin_v1_Args): Plugin_v1 {
  return {
    commands: [
      command({
        command: c.command`/heads`,
        handle: ([]) => {
          windows_v1.open(({ signal, on_action, on_name_change }) => {
            let carried_item$ = new Signal.State<Slot | null>(null);

            let search$ = new Signal.State<string>("");
            let page$ = new Signal.State<number>(0);

            let force_search$ = new Signal.State<string>("");

            /// When doing force search, the server still sends an empty name once...
            let pending_reset = false;

            on_action.on(
              (event) => {
                if (event.slot === 0) {
                  /// Previous page
                  /// To prevent the search from being reset
                  force_search$.set(search$.get());
                  pending_reset = true;

                  let page = page$.get();
                  if (page === 0) {
                    page$.set(0);
                  } else {
                    page$.set(page - 1);
                  }
                } else if (event.slot === 1) {
                  /// Categories?
                } else if (event.slot === 2) {
                  /// Next page
                  force_search$.set(search$.get());
                  pending_reset = true;
                  page$.set(page$.get() + 1);
                } else {
                  carried_item$.set(event.carried_item);
                }
              },
              { signal: signal }
            );

            on_name_change.on(
              (name) => {
                if (pending_reset) {
                  pending_reset = false;
                  return;
                }

                page$.set(0);
                search$.set(name);
              },
              { signal: signal }
            );

            let heads_to_show$ = new Signal.Computed(() => {
              let search = search$.get().toLowerCase();
              let page = page$.get();
              return search_heads(search, {
                pagesize: 9 * 3,
                page: page$.get(),
              });
            });

            return new Signal.Computed(() => {
              let heads_as_items = heads_to_show$
                .get()
                .map((head): Slot | null => {
                  return {
                    item: "minecraft:player_head",
                    properties: {
                      item_name: chat.red`${head.name}`,
                      profile: {
                        name: head.name.slice(0, 16),
                        /// TODO This breaks in some places
                        // uuid: head.uuid,
                        properties: [{ name: "textures", value: head.value }],
                      },
                    },
                  };
                });

              let page = page$.get() + 1;

              return {
                title: "Head Search",
                type: "minecraft:anvil",
                inventory: [
                  {
                    item: "minecraft:player_head",
                    properties: {
                      item_name: force_search$.get(),
                      lore: [
                        page$.get() === 0 ?
                          chat.dark_red(chat.strikethrough`Previous page`)
                        : chat.white`Previous page (${page - 1})`,
                      ],
                      profile: {
                        name: "Previous page",
                        properties: [
                          { name: "textures", value: ARROW_BACK_BLACK },
                        ],
                      },
                    },
                  },
                  {
                    item: "minecraft:book",
                    count: page,
                    properties: {
                      item_name: chat.green`Page ${page}`,
                    },
                  },
                  {
                    item: "minecraft:player_head",
                    properties: {
                      item_name: chat.white`Next page (${page + 1})`,
                      profile: {
                        name: "Next page",
                        properties: [
                          { name: "textures", value: ARROW_FORWARD_BLACK },
                        ],
                      },
                    },
                  },
                ] satisfies Array<Slot | null>,
                survival_inventory: heads_as_items,
                carried_item: carried_item$.get(),
              };
            });
          });
        },
      }),

      command({
        command: c.command`/heads ${base64("Texture")}`,
        handle: ([texture]) => {
          player.inventory.set_hotbar_slot(
            player.inventory.selected_hotbar_slot,
            {
              item: "minecraft:player_head",
              properties: {
                item_name: chat.red`Custom Head`,
                profile: {
                  name: "Wooop",
                  properties: [
                    {
                      name: "textures",
                      value: texture,
                    },
                  ],
                },
              },
            }
          );
        },
      }),
    ],
  };
}

let texture_id_to_value = (texture_id: string) => {
  return btoa(
    JSON.stringify({
      textures: {
        SKIN: {
          url: `http://textures.minecraft.net/texture/${texture_id}`,
        },
      },
    })
  );
};

let ARROW_BACK_SLIM_BLACK = texture_id_to_value(
  "84701a0d2b4ce2153ef6c17d54416355c3d856c7714da990cd5602e6d0c9046b"
);
let ARROW_FORWARD_BLACK = texture_id_to_value(
  "c23b5fda22d0d3a31a06fe781f943cc59f036e2d88c75391f551467a56c52665"
);

let WOOD_ARROW_BACK =
  "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvNzM3NjQ4YWU3YTU2NGE1Mjg3NzkyYjA1ZmFjNzljNmI2YmQ0N2Y2MTZhNTU5Y2U4YjU0M2U2OTQ3MjM1YmNlIn19fQ";
let ARROW_BACK_BLACK =
  "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCIgOiAiaHR0cDovL3RleHR1cmVzLm1pbmVjcmFmdC5uZXQvdGV4dHVyZS8xYTkwZDFmYzEzYjUwZTdjYmU4YjVkNmQyN2NlYmIyZTYwM2Y1YmI4NmU5NzUzYzQxNmQwMmExOTBiZmYyYiJ9fX0=";
