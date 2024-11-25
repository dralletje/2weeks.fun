import {
  type TextComponentStyle,
  type TextComponent,
} from "../protocol/text-component.ts";

let tx = (text: TextComponentable): TextComponent =>
  typeof text === "string"
    ? { text }
    : typeof text === "number"
      ? { text: `${text}` }
      : typeof text === "boolean"
        ? { text: `${text}` }
        : Array.isArray(text)
          ? {
              text: "",
              extra:
                text.length === 0 ? [{ text: "" }] : text.map((x) => tx(x)),
            }
          : text == null
            ? { text: "" }
            : text;

type TextComponentable =
  | string
  | TextComponent
  | Array<TextComponentable>
  | number
  | boolean;

type TemplateTagOrJustFunction<Input, Values extends Array<any>, Output> = ((
  strings: ArrayLike<Input | string>,
  ...args: Values
) => Output) &
  ((string: Input | string) => Output);

let templatable = <Input, Values extends Array<any>, Output>(
  fn: (strings: ArrayLike<Input | string>, ...args: Values) => Output
): TemplateTagOrJustFunction<Input, Values, Output> => {
  return (strings_or_string, ...args) => {
    if (Array.isArray(strings_or_string)) {
      // @ts-ignore
      return fn(strings_or_string, ...args);
    } else {
      // @ts-ignore
      return fn([strings_or_string]);
    }
  };
};

let chat_and = (chat_props: Partial<TextComponentStyle>) =>
  templatable(
    (
      strings: ArrayLike<TextComponentable>,
      ...args: Array<TextComponentable>
    ): TextComponent => ({
      ...chat(strings, ...args),
      ...chat_props,
    })
  );

export let chat = Object.assign(
  templatable(
    (
      strings: ArrayLike<TextComponentable>,
      ...args: Array<TextComponentable>
    ): TextComponent => {
      if (!Array.isArray(strings)) {
        throw new Error(`Expected strings to be an array, got ${strings}`);
      }

      let result: Array<TextComponent> = [];
      for (let i = 0; i < strings.length; i++) {
        result.push(tx(strings[i]));

        let arg = args[i];
        result.push(tx(arg));
      }

      if (result.length === 0) {
        return { text: "" };
      } else {
        return { text: "", extra: result };
      }
    }
  ),
  {
    bold: chat_and({ bold: true }),
    italic: chat_and({ italic: true }),
    underlined: chat_and({ underlined: true }),
    strikethrough: chat_and({ strikethrough: true }),
    obfuscated: chat_and({ obfuscated: true }),

    black: chat_and({ color: "black" }),
    dark_blue: chat_and({ color: "dark_blue" }),
    dark_green: chat_and({ color: "dark_green" }),
    dark_aqua: chat_and({ color: "dark_aqua" }),
    dark_red: chat_and({ color: "dark_red" }),
    dark_purple: chat_and({ color: "dark_purple" }),
    gold: chat_and({ color: "gold" }),
    gray: chat_and({ color: "gray" }),
    dark_gray: chat_and({ color: "dark_gray" }),
    blue: chat_and({ color: "blue" }),
    green: chat_and({ color: "green" }),
    aqua: chat_and({ color: "aqua" }),
    red: chat_and({ color: "red" }),
    light_purple: chat_and({ color: "light_purple" }),
    yellow: chat_and({ color: "yellow" }),
    white: chat_and({ color: "white" }),

    suggest_command: (
      text: TextComponentable,
      command: string
    ): TextComponent => ({
      ...tx(text),
      clickEvent: { action: "suggest_command", value: command },
    }),
  }
);

// chat.white`Hello, world!`;
