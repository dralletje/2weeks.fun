import { registries } from "@2weeks/minecraft-data";
import {
  type CommandNode,
  type CommandParser,
  flatten_command_node,
} from "../protocol/brigadier.ts";
import { isEmpty } from "lodash-es";

let registry_names = Object.keys(registries);

export default function brigadier() {
  let argument_types: Array<CommandParser> = [
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

  let nodes: CommandNode = {
    type: "literal",
    name: "brigadier",
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
        } satisfies CommandNode;
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
        } satisfies CommandNode;
      }
    }),
  };

  return { nodes };
}
