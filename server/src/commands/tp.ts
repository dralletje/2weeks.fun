import { zip } from "lodash-es";
import { type CommandParser } from "../protocol/brigadier.ts";

type ActualParser<T> = (path: string) => [T, string] | null;

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

  constructor(
    [first, ...rest]: TemplateStringsArray,
    args: Array<CommandArgument<any>>
  ) {
    this.parts = [
      literal(first),
      ...zip(args, rest).flatMap(([arg, string]) => [arg!, literal(string!)]),
    ];

    console.log(`this.parts:`, this.parts);
  }

  parse(command: string): { results: Arguments; priority: number } | null {
    let left = command;
    let results: Arguments = [] as any;
    let priority = 0;

    for (let part of this.parts) {
      if (part.type === "CommandLiteral") {
        if (!left.startsWith(part.literal)) {
          return null;
        }
        left = left.slice(part.literal.length).trimStart();
        priority += LITERAL_PRIORITY;
      } else {
        let result = part.parse(left.trimStart());
        if (result === null) {
          return null;
        }
        let [value, consumed] = result;
        results.push(value);
        left = left.slice(consumed.length);
        priority += part.priority;
      }
    }

    return { results: results, priority: priority };
  }
}

type CommandArgumentValues<Tuple extends [...any[]]> = {
  [Index in keyof Tuple]: CommandArgumentValue<Tuple[Index]>;
} & { length: Tuple["length"] };

let b = {
  command: <const Args extends Array<CommandArgument<any>>>(
    strings: TemplateStringsArray,
    ...args: Args
  ) => {
    return new CommandTemplate<CommandArgumentValues<Args>>(strings, args);
  },
  vec3: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "minecraft:vec3" },
      priority: 10,
      parse: (arg) => {
        let [x, y, z] = arg.split(" ");
        let str = [x, y, z].join(" ");

        let vec3 = { x: parseFloat(x), y: parseFloat(y), z: parseFloat(z) };

        if (isNaN(vec3.x) || isNaN(vec3.y) || isNaN(vec3.z)) {
          return null;
        }

        return [vec3, str];
      },
    }),
  word: (name: string) =>
    new CommandArgument({
      name: name,
      brigadier_type: { type: "brigadier:string", behavior: "SINGLE_WORD" },
      priority: 5,
      parse: (arg) => {
        let [x] = arg.split(" ");
        return [x, `${x}`];
      },
    }),
};

let register_command = <Arguments extends Array<any>>(
  command: CommandTemplate<Arguments>,
  handle: (args: Arguments) => void
) => {};

let p = b.command`/tp ${b.vec3("destination")} to ${b.word("player")}`;

console.log(`p:`, p.parse("/tp 1 2 5 to MichielDral"));

export default function tp_plugin() {
  register_command(b.command`/tp ${b.vec3("destination")}`, ([destination]) => {
    destination.x;
  });
}
