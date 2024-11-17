import { zip } from "lodash-es";
import { type CommandNode, type CommandParser } from "../protocol/brigadier.ts";
import { type CommandHandler } from "../app.ts";
import { BasicPlayer } from "../BasicPlayer.ts";
import { type AnySignal } from "../signals.ts";
import { type Entity } from "../player-synchronizers/entities.ts";
import { type TextComponent } from "../protocol/text-component.ts";

type ActualParser<T> = (
  path: string,
  context: { player: BasicPlayer }
) => [T, string] | null;

class CommandArgument<T> {
  type = "CommandArgument" as const;
  name: string;
  brigadier_type: CommandParser;
  parse: ActualParser<T>;
  priority: number;

  constructor(options: {
    name: string;
    brigadier_type: CommandParser;
    priority: number;
    parse: ActualParser<T>;
  }) {
    this.name = options.name;
    this.brigadier_type = options.brigadier_type;
    this.parse = options.parse;
    this.priority = options.priority;
  }
}

type CommandPart =
  | { type: "CommandLiteral"; literal: string }
  | {
      type: "CommandArgument";
      name: string;
      brigadier_type: CommandParser;
      parse: ActualParser<any>;
      priority: number;
    };

let literal = (literal: string): CommandPart => ({
  type: "CommandLiteral" as const,
  literal: literal,
});

type CommandArgumentValue<T> = T extends CommandArgument<infer U> ? U : never;

let LITERAL_PRIORITY = 1000;

class CommandTemplate<const Arguments extends Array<any>> {
  parts: Array<CommandPart> = [];

  brigadier(): CommandNode {
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

    let leaf: CommandNode =
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
          };

    let x = rest.reduce((child: CommandNode, part): CommandNode => {
      return part.type === "CommandLiteral"
        ? {
            type: "literal",
            name: part.literal.trim(),
            children: [child],
            is_executable: false,
          }
        : {
            type: "argument",
            name: part.name,
            parser: part.brigadier_type,
            children: [child],
            is_executable: false,
          };
    }, leaf);

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
    context: { player: BasicPlayer }
  ): { results: Arguments; priority: number } | null {
    if (!command.startsWith("/")) {
      throw new Error("Command must start with a slash");
    }

    let left = command.slice(1).trim();
    let results: Arguments = [] as any;
    let priority = 0;

    for (let part of this.parts) {
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
}

type CommandArgumentValues<Tuple extends [...any[]]> = {
  [Index in keyof Tuple]: CommandArgumentValue<Tuple[Index]>;
} & { length: Tuple["length"] };

export let p = {
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
        console.log(`x,y,z:`, x, y, z);
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

  float: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:float" },
      priority: 5,
      parse: (arg, { player }) => {
        let [x] = arg.split(" ");
        return [parseFloat(x), `${x}`];
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
        let [x] = arg.split(" ");
        return [x, `${x}`];
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

  resource: (name: string, registry: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: {
        type: "minecraft:resource",
        registry: registry,
      },
      priority: 50,
      parse: (arg, { player }) => {
        let [x] = arg.split(" ");
        return [x, `${x}`];
      },
    }),
  player: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: {
        type: "minecraft:entity",
        multiple: false,
        only_players: true,
      },
      priority: 50,
      parse: (arg, { player }) => {
        let [x] = arg.split(" ");
        return [x, `${x}`];
      },
    }),
};

export let Command = <Arguments extends Array<any>>({
  command,
  handle,
}: {
  command: CommandTemplate<Arguments>;
  // handle: (args: Arguments) => void
  handle: CommandHandler<Arguments>;
}) => {
  return {
    parse: (string, context) => command.parse(string, context),
    handle,
    brigadier: command.brigadier(),
  };
};

type Plugin_v1_Command<Arguments extends Array<any>> = {
  parse: (
    string: string,
    context: { player: BasicPlayer }
  ) => null | { results: Arguments; priority: number };
  handle: CommandHandler<Arguments>;
  brigadier: CommandNode;
};

export type Plugin_v1_Args = {
  player: BasicPlayer;
  send_packet: (packet: Uint8Array) => void;
};

export type ListedPlayer = {
  name: string;
  properties: Array<{
    name: string;
    value: string;
    signature: string | null;
  }>;
  game_mode: "creative" | "survival" | "adventure" | "spectator";
  ping: number;
  display_name: TextComponent | string | null;
  listed: boolean;
};

export type Plugin_v1 = {
  sinks?: {
    entities$?: AnySignal<Map<bigint, Entity>>;
    listed_players$?: AnySignal<Map<bigint, ListedPlayer>>;
  };
  commands?: Array<Plugin_v1_Command<any>>;
};
