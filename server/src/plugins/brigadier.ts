import { registries } from "@2weeks/minecraft-data";
import { isEmpty } from "lodash-es";
import { chat } from "../utils/chat.ts";
import {
  c,
  command,
  type BrigadierCommandNode,
} from "../PluginInfrastructure/Commands_v1.ts";
import { type Plugin_v1 } from "../PluginInfrastructure/Plugin_v1.ts";
import {
  type BrigadierSuggestionType,
  type BrigadierParser,
} from "../protocol/brigadier.ts";

let registry_names = Object.keys(registries);

export default function brigadier(): Plugin_v1 {
  let argument_types: Array<BrigadierParser> = [
    { type: "brigadier:bool" },
    { type: "brigadier:double" },
    { type: "brigadier:float" },
    { type: "brigadier:integer" },
    { type: "brigadier:long" },

    {
      type: "brigadier:string",
      behavior: "SINGLE_WORD",
    },
    {
      type: "brigadier:string",
      behavior: "QUOTABLE_PHRASE",
    },
    {
      type: "brigadier:string",
      behavior: "GREEDY_PHRASE",
    },

    { type: "minecraft:entity", multiple: false, only_players: false },
    { type: "minecraft:entity", multiple: false, only_players: true },
    { type: "minecraft:entity", multiple: true, only_players: false },
    { type: "minecraft:entity", multiple: true, only_players: true },

    { type: "minecraft:game_profile" },
    { type: "minecraft:block_pos" },
    { type: "minecraft:column_pos" },
    { type: "minecraft:vec3" },
    { type: "minecraft:vec2" },
    { type: "minecraft:block_state" },
    { type: "minecraft:block_predicate" },
    { type: "minecraft:item_stack" },
    { type: "minecraft:item_predicate" },
    { type: "minecraft:color" },
    { type: "minecraft:component" },
    { type: "minecraft:style" },
    { type: "minecraft:message" },
    { type: "minecraft:nbt_compound_tag" },
    { type: "minecraft:nbt_tag" },
    { type: "minecraft:nbt_path" },
    { type: "minecraft:objective" },
    { type: "minecraft:objective_criteria" },
    { type: "minecraft:operation" },
    { type: "minecraft:particle" },
    { type: "minecraft:angle" },
    { type: "minecraft:rotation" },
    { type: "minecraft:scoreboard_slot" },

    { type: "minecraft:score_holder", multiple: true },
    { type: "minecraft:score_holder", multiple: false },

    { type: "minecraft:swizzle" },
    { type: "minecraft:team" },
    { type: "minecraft:item_slot" },
    { type: "minecraft:item_slots" },
    { type: "minecraft:resource_location" },
    { type: "minecraft:function" },
    { type: "minecraft:entity_anchor" },
    { type: "minecraft:int_range" },
    { type: "minecraft:float_range" },
    { type: "minecraft:dimension" },
    { type: "minecraft:gamemode" },
    { type: "minecraft:time", min: 0 },
    ...registry_names.map((registry) => ({
      type: "minecraft:resource_or_tag" as const,
      registry,
    })),
    ...registry_names.map((registry) => ({
      type: "minecraft:resource_or_tag_key" as const,
      registry,
    })),
    ...registry_names.map((registry) => ({
      type: "minecraft:resource" as const,
      registry,
    })),
    ...registry_names.map((registry) => ({
      type: "minecraft:resource_key" as const,
      registry,
    })),

    { type: "minecraft:template_mirror" },
    { type: "minecraft:template_rotation" },
    { type: "minecraft:heightmap" },
    { type: "minecraft:loot_modifier" },
    { type: "minecraft:loot_predicate" },
    { type: "minecraft:loot_table" },
    { type: "minecraft:uuid" },
  ];

  let parser_node: BrigadierCommandNode = {
    type: "literal",
    name: "parser",
    is_executable: false,
    children: argument_types.map((parser) => {
      let { type, ...options } = parser;
      if (isEmpty(options)) {
        return {
          type: "literal",
          name: type,
          is_executable: true,
          children: [
            {
              type: "argument",
              name: type,
              parser: parser,
              children: [],
              is_executable: true,
            },
          ],
        } satisfies BrigadierCommandNode;
      } else {
        return {
          type: "literal",
          name: type,
          is_executable: false,
          children: [
            {
              type: "literal",
              name: `[${Object.entries(options)
                .map(([key, value]) => `${key}=${value}`)
                .join(",")}]`,
              is_executable: false,
              children: [
                {
                  type: "argument",
                  name: "options",
                  parser: parser,
                  children: [],
                  is_executable: true,
                },
              ],
            },
          ],
        } satisfies BrigadierCommandNode;
      }
    }),
  };

  let suggestion_types: Array<BrigadierSuggestionType> = [
    "minecraft:ask_server",
    "minecraft:all_recipes",
    "minecraft:available_sounds",
    "minecraft:summonable_entities",
  ];

  let suggestion_nodes: BrigadierCommandNode = {
    type: "literal",
    name: "suggestion_type",
    is_executable: false,
    children: suggestion_types.map((suggestion_type) => ({
      type: "literal",
      name: suggestion_type,
      is_executable: false,
      children: [
        {
          type: "argument",
          name: suggestion_type,
          parser: { type: "brigadier:string", behavior: "SINGLE_WORD" },
          children: [],
          is_executable: true,
          suggestion_type: suggestion_type,
          server_suggestions: () => {},
        },
      ],
    })),
  };

  let suggest_current_date = () => {
    return [
      {
        text: `"${new Date().toISOString()}"`,
      },
    ];
  };

  return {
    commands: [
      // command({
      //   command: c.command`/brigadier suggestion_type minecraft:ask_server ${c.ask_server2(c.word("Date"), suggest_current_date)}`,
      //   handle: ([], { player }) => {
      //     player.send(
      //       chat`${chat.green("*")} ${chat.gray("Also does nothing!")}`
      //     );
      //   },
      // }),
      {
        execute: ([], { player }) => {
          player.send(
            chat`${chat.green("*")} ${chat.gray("Command does nothing!")}`
          );
        },
        suggest: (command, context) => {
          if (command.startsWith("/brigadier")) {
            return {
              args: [],
              start: 0,
              length: command.length,
              priority: 1,
              suggest: () => [
                { text: "From The Server!" },
                { text: "With Tooltip", tooltip: "This is a tooltip!" },
              ],
            };
          } else {
            return null;
          }
        },
        brigadier: {
          type: "literal",
          name: "brigadier",
          is_executable: false,
          children: [parser_node, suggestion_nodes],
        },
        parse: (command) => {
          if (command.startsWith("/brigadier")) {
            return { results: [], priority: 1000000 };
          }
          return null;
        },
      },
    ],
  };
}
