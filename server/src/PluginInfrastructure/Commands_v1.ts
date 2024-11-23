import { isEmpty, isEqual, zip } from "lodash-es";
import { BasicPlayer } from "../BasicPlayer.ts";
import {
  type BrigadierParser,
  type BrigadierSuggestionType,
} from "../protocol/brigadier.ts";
import {
  chat_to_text,
  type TextComponent,
} from "../protocol/text-component.ts";
import { type NestedBrigadierNode } from "../Drivers/commands_driver/brigadier_helpers.ts";
import {
  blocks,
  get_block_by_properties,
  type BlockState,
} from "@2weeks/minecraft-data";
import { regexp } from "../utils/regexp-tag.ts";
import {
  registries,
  type RegistryName,
  type RegistryResourceKey,
} from "@2weeks/minecraft-data/registries";

type ActualParser<T> = (
  path: string,
  context: CommandContext
) => [T, string] | null;

export type CommandContext = {
  player: BasicPlayer;
  players: Map<string, bigint>;
};

export type ServerSuggestion = {
  text: string;
  tooltip?: TextComponent | string;
};
type ServerSuggestionCallback = (suggestion_request: {
  prefix: string;
  so_far: string;
  args: Array<any>;
  context: CommandContext;
}) => Array<ServerSuggestion>;

class CommandArgument<T> {
  type = "CommandArgument" as const;
  name: string;
  brigadier_type: BrigadierParser;
  suggestion_type?: BrigadierSuggestionType;
  server_suggestion_callback?: ServerSuggestionCallback;

  parse: ActualParser<T>;
  priority: number;

  constructor(options: {
    name: string;
    brigadier_type: BrigadierParser;
    priority: number;
    suggestion_type?: BrigadierSuggestionType;
    parse: ActualParser<T>;
    server_suggestion_callback?: ServerSuggestionCallback;
  }) {
    this.name = options.name;
    this.brigadier_type = options.brigadier_type;
    this.parse = options.parse;
    this.priority = options.priority;
    this.suggestion_type = options.suggestion_type;
    this.server_suggestion_callback = options.server_suggestion_callback;
  }
}

type CommandPart =
  | { type: "CommandLiteral"; literal: string }
  | CommandArgument<any>;

let literal = (literal: string): CommandPart => ({
  type: "CommandLiteral" as const,
  literal: literal,
});

type CommandArgumentValue<T> = T extends CommandArgument<infer U> ? U : never;

let LITERAL_PRIORITY = 1000;

class CommandTemplate<const Arguments extends Array<any>> {
  parts: Array<CommandPart> = [];

  brigadier(): NestedBrigadierNode {
    let pp = this.parts
      .flatMap((x): Array<CommandPart> => {
        if (x.type === "CommandLiteral") {
          return x.literal
            .trim()
            .split(/ +/)
            .map((literal) => ({
              type: "CommandLiteral" as const,
              literal: literal.trim(),
            }));
        } else {
          return [x];
        }
      })
      .toReversed();

    let [first, ...rest] = pp;

    let leaf: NestedBrigadierNode =
      first.type === "CommandLiteral"
        ? {
            type: "literal",
            name: first.literal.trim(),
            children: [],
            is_executable: true,
          }
        : {
            type: "argument",
            name: first.name,
            parser: first.brigadier_type,
            children: [],
            is_executable: true,
            suggestion_type: first.suggestion_type,
          };

    let x = rest.reduce(
      (child: NestedBrigadierNode, part): NestedBrigadierNode => {
        if (part.type === "CommandLiteral") {
          return {
            type: "literal",
            name: part.literal.trim(),
            children: [child],
            is_executable: false,
          };
        } else {
          return {
            type: "argument",
            name: part.name,
            parser: part.brigadier_type,
            children: [child],
            is_executable: false,
            suggestion_type: part.suggestion_type,
          };
        }
      },
      leaf
    );

    return x;
  }

  constructor(
    [first, ...rest]: TemplateStringsArray,
    args: Array<CommandArgument<any>>
  ) {
    if (!first.startsWith("/")) {
      throw new Error("Command must start with a slash");
    }

    this.parts = [
      literal(first.slice(1)),
      ...zip(args, rest).flatMap(([arg, string]) => [arg!, literal(string!)]),
    ].filter((x) => x.type !== "CommandLiteral" || x.literal.trim() !== "");
  }

  parse(
    command: string,
    context: CommandContext
  ): { results: Arguments; priority: number } | null {
    if (!command.startsWith("/")) {
      throw new Error("Command must start with a slash");
    }

    let left = command.slice(1).trim();
    let results: Arguments = [] as any;
    let priority = 0;

    for (let part of this.parts) {
      left = left.trim();

      if (part.type === "CommandLiteral") {
        for (let pp of part.literal.trim().split(/ +/)) {
          if (!left.startsWith(pp)) {
            return null;
          }
          left = left.slice(pp.length).trimStart();
          priority += LITERAL_PRIORITY;
        }
        // left = left.slice(part.literal.length).trimStart();
        // priority += LITERAL_PRIORITY;
      } else {
        let trimmed = left.trimStart();
        let amount_trimmed = left.length - trimmed.length;
        let result = part.parse(trimmed, context);
        if (result === null) {
          return null;
        }
        let [value, consumed] = result;
        results.push(value);
        left = left.slice(amount_trimmed + consumed.length);
        priority += part.priority;
      }
    }

    if (left.trim() !== "") {
      return null;
    }

    return { results: results, priority: priority };
  }

  suggest(command: string, context: CommandContext): Suggester | null {
    // console.log(`command:`, command);
    // console.log(`this:`, this);
    if (!command.startsWith("/")) {
      throw new Error("Command must start with a slash");
    }

    let left = command.slice(1);
    let priority = 0;
    let args: Array<any> = [];

    for (let part of this.parts) {
      left = left.trimStart();
      if (part.type === "CommandLiteral") {
        for (let pp of part.literal.trim().split(/ +/)) {
          if (!left.startsWith(pp)) {
            return null;
          }
          left = left.slice(pp.length).trimStart();
          priority += LITERAL_PRIORITY;
        }
      } else {
        let trimmed = left.trimStart();

        let amount_trimmed = left.length - trimmed.length;
        let result = part.parse(trimmed, context);

        if (result == null) {
          if (part.server_suggestion_callback == null) {
            return null;
            console.log("NOT SUGGESTING");
          } else {
            let suggestion_callback = part.server_suggestion_callback;
            return {
              priority: priority,
              args: args,
              start: command.length - left.length,
              length: left.length,
              suggest: () =>
                suggestion_callback({
                  prefix: command,
                  so_far: left,
                  args: args,
                  context: context,
                }),
            };
          }
        }

        let [value, consumed] = result;
        left = left.slice(amount_trimmed + consumed.length);

        if (left.trim() === "") {
          if (part.server_suggestion_callback == null) {
            return null;
          } else {
            let suggestion_callback = part.server_suggestion_callback;
            return {
              priority: priority,
              args: args,
              start: command.length - consumed.length,
              length: left.length,
              suggest: () =>
                suggestion_callback({
                  prefix: command,
                  so_far: consumed,
                  args: args,
                  context: context,
                }),
            };
          }
        }

        args.push(value);
        left = left.slice(amount_trimmed + consumed.length);
        priority += part.priority;
      }
    }

    return null;
  }
}

type CommandArgumentValues<Tuple extends [...any[]]> = {
  [Index in keyof Tuple]: CommandArgumentValue<Tuple[Index]>;
} & { length: Tuple["length"] };

export let c = {
  command: <const Args extends Array<CommandArgument<any>>>(
    strings: TemplateStringsArray,
    ...args: Args
  ) => {
    return new CommandTemplate<CommandArgumentValues<Args>>(strings, args);
  },
  vec3: (name: string) =>
    new CommandArgument<{ x: number; y: number; z: number }>({
      name: name,
      brigadier_type: { type: "minecraft:vec3" },
      priority: 10,
      parse: (arg, { player }) => {
        let match = arg.match(/^([^ ]+) ([^ ]+) ([^ ]+)/);
        if (match === null) {
          return null;
        }
        let [x, y, z] = match.slice(1);

        let is_local_relative =
          x.startsWith("^") || y.startsWith("^") || z.startsWith("^");
        let is_world_relative =
          x.startsWith("~") || y.startsWith("~") || z.startsWith("~");

        if (is_local_relative && is_world_relative) {
          /// Give an error?
          return null;
        }

        if (is_local_relative) {
          // let [px, py, pz] = [
          //   player.position.x,
          //   player.position.y,
          //   player.position.z,
          // ];
          // let x_num = parseFloat(x.replace("^", ""));
          // let y_num = parseFloat(y.replace("^", ""));
          // let z_num = parseFloat(z.replace("^", ""));

          // if (isNaN(x_num) || isNaN(y_num) || isNaN(z_num)) {
          //   return null;
          // }

          // return [{ x: px + x_num, y: py + y_num, z: pz + z_num }, match[0]];

          return null;
        }

        let [px, py, pz] = [
          player.position.x,
          player.position.y,
          player.position.z,
        ];
        let x_num =
          x === "~"
            ? px
            : x.startsWith("~")
              ? parseFloat(x.replace("~", "")) + px
              : parseFloat(x);
        let y_num =
          y === "~"
            ? py
            : y.startsWith("~")
              ? parseFloat(y.replace("~", "")) + py
              : parseFloat(y);
        let z_num =
          z === "~"
            ? pz
            : z.startsWith("~")
              ? parseFloat(z.replace("~", "")) + pz
              : parseFloat(z);

        if (isNaN(x_num) || isNaN(y_num) || isNaN(z_num)) {
          return null;
        }

        return [{ x: x_num, y: y_num, z: z_num }, match[0]];
      },
    }),

  block_state: (name: string) =>
    new CommandArgument<{ name: string; state: BlockState }>({
      name: name,
      brigadier_type: { type: "minecraft:block_state" },
      priority: 10,
      parse: (arg, { player }) => {
        // let [name, ...properties] = arg.split(" ");

        let named = (name: string, regex: RegExp) =>
          regexp`^(?<${name}>${regex})$`;
        let not = (charset: string) => regexp`^[^${charset}]$`;

        let block_name_regex = regexp`^[a-zA-Z_:]+$`;
        let block_state = regexp`^${"["}${not("]")}+${"]"}$`;
        let block_state_regex = regexp`^${named("block", block_name_regex)}${named("properties", block_state)}?`;

        let match = arg.match(block_state_regex);
        if (match == null) {
          return null;
        }

        let x = match.groups! as { block: string; properties?: string };

        let properties_as_object = Object.fromEntries(
          x.properties
            ?.slice(1, -1)
            .split(",")
            .map((x) => x.trim().split("=", 2) as [string, string]) ?? []
        );

        let block = blocks[x.block] ?? blocks[`minecraft:${x.block}`];

        let state = get_block_by_properties(block, properties_as_object);

        if (state == null) {
          return null;
        } else {
          return [{ name: x.block, state: state }, match[0]];
        }
        // if (isEmpty(block.properties) && isEmpty(properties_as_object)) {
        //   return [{ name: x.block, state: default_state }, match[0]];
        // }

        // /// Check if all properties are valid
        // for (let [key, value] of Object.entries(properties_as_object)) {
        //   if (block.properties?.[key] == null) {
        //     /// Property does not exist
        //     return null;
        //   }
        //   if (!block.properties?.[key].includes(value)) {
        //     /// Value is not valid
        //     return null;
        //   }
        // }

        // /// Merge with default properties
        // let properties_to_match = {
        //   ...default_state.properties,
        //   ...properties_as_object,
        // };

        // /// Find matching state
        // for (let state of block.states) {
        //   if (isEqual(state.properties, properties_to_match)) {
        //     return [{ name: x.block, state: state }, match[0]];
        //   }
        // }

        return null;
      },
    }),

  integer: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:integer" },
      priority: 5,
      parse: (arg, { player }) => {
        if (arg.length === 0) return null;
        let [x] = arg.split(" ");
        let num = parseInt(x);
        if (Number.isNaN(num)) {
          return null;
        }
        return [num, `${x}`];
      },
    }),
  float: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:float" },
      priority: 5,
      parse: (arg, { player }) => {
        if (arg.length === 0) return null;
        let [x] = arg.split(" ");
        let num = parseFloat(x);
        if (Number.isNaN(num)) {
          return null;
        }
        return [num, `${x}`];
      },
    }),
  entity: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: {
        type: "minecraft:entity",
        multiple: false,
        only_players: false,
      },
      priority: 5,
      parse: (arg, { player }) => {
        let [x] = arg.split(" ");
        return [parseFloat(x), `${x}`];
      },
    }),

  word: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:string", behavior: "SINGLE_WORD" },
      priority: 5,
      parse: (arg, { player }) => {
        if (arg.length === 0) {
          return null;
        }
        let [x] = arg.split(" ");
        return [x, `${x}`];
      },
    }),
  string: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:string", behavior: "GREEDY_PHRASE" },
      priority: 5,
      parse: (arg, { player }) => {
        if (arg.startsWith('"')) {
          let match = arg.match(/"([^"]+)"/);
          if (match == null) {
            return null;
          }
          return [match[1], match[0]];
        } else {
          let [x] = arg.split(" ");
          return [x, `${x}`];
        }
      },
    }),

  rest: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:string", behavior: "GREEDY_PHRASE" },
      priority: 1,
      parse: (arg, { player }) => {
        console.log(`arg:`, arg);
        if (arg.length === 0) {
          return null;
        }
        return [arg, arg];
      },
    }),

  resource: <Key extends RegistryName>(name: string, registry: Key) =>
    new CommandArgument({
      name: name,
      brigadier_type: {
        type: "minecraft:resource",
        registry: registry,
      },
      priority: 50,
      parse: (arg, { player }) => {
        let [x] = arg.split(" ");

        if (registries[registry].entries[x] == null) {
          return null;
        }

        return [x as RegistryResourceKey<Key>, `${x}`];
      },
    }),
  player: (name: string) =>
    new CommandArgument<{ name: string } | { name: string; uuid: bigint }>({
      name: name,
      brigadier_type: {
        type: "minecraft:entity",
        multiple: false,
        only_players: true,
      },
      priority: 50,
      parse: (arg, { player, players }) => {
        let [name] = arg.split(" ");

        if (name.length === 0) {
          return null;
        }

        let uuid = players.get(name);

        if (uuid == null) {
          return [{ name: name }, name];
        }

        return [{ name: name, uuid: uuid }, name];
      },
    }),
  ask_server: <T>(
    name: string,
    server_suggestion_callback: ServerSuggestionCallback
  ) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:string", behavior: "SINGLE_WORD" },
      suggestion_type: "minecraft:ask_server",
      server_suggestion_callback: server_suggestion_callback,
      priority: 100,
      parse: (arg, { player }) => {
        if (arg.length === 0) {
          return null;
        }
        let [x] = arg.split(" ");
        return [x, `${x}`];
      },
    }),

  ask_server2: <T>(
    argument: CommandArgument<T>,
    server_suggestion_callback: ServerSuggestionCallback
  ) =>
    new CommandArgument({
      ...argument,
      suggestion_type: "minecraft:ask_server",
      server_suggestion_callback: server_suggestion_callback,
    }),
};

// let x = c.block_state("Block").parse("minecraft:glass_pane[east=true]", {});
// let y = c
//   .block_state("Block")
//   .parse("minecraft:glass_pane[east=true, north=false]", {});
// let wrong_1 = c
//   .block_state("Block")
//   .parse("minecraft:glass_pane[east=true, north=wrong]", {});
// let wrong_2 = c
//   .block_state("Block")
//   .parse("minecraft:glass_pane[east=true, nonexistent=true]", {});
// console.log(`x:`, x);
// console.log(`y:`, y);
// console.log(`wrong_1:`, wrong_1);
// console.log(`wrong_2:`, wrong_2);

type CommandExecutor<Args> = (
  args: Args,
  context: {
    player: BasicPlayer;
  }
) => Promise<void> | void;

type Suggester = {
  priority: number;
  start: number;
  length: number;
  args: Array<any>;
  suggest: () => Array<ServerSuggestion>;
};

export type Command_v1<Arguments extends Array<any>> = {
  parse: (
    string: string,
    context: CommandContext
  ) => null | { results: Arguments; priority: number };
  execute: CommandExecutor<Arguments>;
  brigadier: NestedBrigadierNode;
  suggest: (string: string, context: CommandContext) => Suggester | null;
};

export class CommandError extends Error {
  name = "CommandError";
  chat: TextComponent | string;
  constructor(message: TextComponent | string) {
    super(chat_to_text(message));
    this.chat = message;
  }
}
export let command = <Arguments extends Array<any>>({
  command,
  handle,
}: {
  command: CommandTemplate<Arguments>;
  handle: CommandExecutor<Arguments>;
}): Command_v1<Arguments> => {
  return {
    parse: (string, context) => command.parse(string, context),
    suggest: (string, context) => command.suggest(string, context),
    execute: handle,
    brigadier: command.brigadier(),
  };
};
