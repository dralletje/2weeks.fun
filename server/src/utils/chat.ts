import { type TextComponent } from "../protocol/text-component.ts";

let tx = (text: TextComponentable): TextComponent =>
  typeof text === "string"
    ? { text }
    : typeof text === "number"
      ? { text: `${text}` }
      : typeof text === "boolean"
        ? { text: String(text) }
        : text;

type TextComponentable = TextComponent | string | number | boolean;

export let chat = Object.assign(
  (
    strings: TemplateStringsArray,
    ...args: Array<TextComponentable>
  ): TextComponent => {
    let result: Array<TextComponent> = [];
    for (let i = 0; i < strings.length; i++) {
      result.push({ text: strings[i] });

      let arg = args[i];
      if (typeof arg === "string") {
        result.push({ text: arg });
      } else if (typeof arg === "number") {
        result.push({ text: arg.toString() });
      } else if (typeof arg === "boolean") {
        result.push({ text: arg ? "true" : "false" });
      } else if (arg == null) {
        /// Pass!
      } else {
        result.push(arg);
      }
    }
    return { text: "", extra: result };
  },
  {
    bold: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      bold: true,
    }),
    italic: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      italic: true,
    }),
    underlined: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      underlined: true,
    }),
    strikethrough: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      strikethrough: true,
    }),
    obfuscated: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      obfuscated: true,
    }),

    black: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "black",
    }),
    dark_blue: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_blue",
    }),
    dark_green: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_green",
    }),
    dark_aqua: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_aqua",
    }),
    dark_red: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_red",
    }),
    dark_purple: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_purple",
    }),
    gold: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "gold",
    }),
    gray: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "gray",
    }),
    dark_gray: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "dark_gray",
    }),
    blue: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "blue",
    }),
    green: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "green",
    }),
    aqua: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "aqua",
    }),
    red: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "red",
    }),
    light_purple: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "light_purple",
    }),
    yellow: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "yellow",
    }),
    white: (text: TextComponentable): TextComponent => ({
      ...tx(text),
      color: "white",
    }),
  }
);
