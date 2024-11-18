import { wrap } from "../protocol.ts";
import { nbt_json } from "./nbt-json.ts";

type ChatColor =
  | "black"
  | "dark_blue"
  | "dark_green"
  | "dark_aqua"
  | "dark_red"
  | "dark_purple"
  | "gold"
  | "gray"
  | "dark_gray"
  | "blue"
  | "green"
  | "aqua"
  | "red"
  | "light_purple"
  | "yellow"
  | "white";

type TextComponentBase = {
  extra?: Array<TextComponent>;
  color?: ChatColor;
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  font?:
    | "minecraft:default"
    | "minecraft:uniform"
    | "minecraft:alt"
    | "minecraft:illageralt"
    | string;
  insertion?: string;
  clickEvent?:
    | { action: "open_url"; value: string }
    | { action: "run_command"; value: string }
    | { action: "suggest_command"; value: string }
    | { action: "change_page"; value: string }
    | { action: "copy_to_clipboard"; value: string };
  hoverEvent?:
    | { action: "show_text"; value: TextComponent }
    | {
        action: "show_item";
        value: { id: string; count: number; tag?: string };
      }
    | {
        action: "show_entity";
        value: { id: string; type: string; name?: string };
      };
};
export type TextComponent =
  | (TextComponentBase & {
      type?: "text";
      text: string;
    })
  | (TextComponentBase & {
      type?: "keybind";
      keybind: string;
    })
  | (TextComponentBase & {
      type?: "translatable";
      translate: string;
      with?: Array<TextComponent>;
    });

export let text_component = wrap({
  protocol: nbt_json,
  encode: (value: TextComponent | string) => {
    return value;
  },
  decode: (value: any) => {
    return value;
  },
});

export let chat_to_text = (value: TextComponent | string) => {
  if (typeof value === "string") {
    return value;
  }

  if ("text" in value) {
    return `${value.text}${value.extra?.map(chat_to_text).join("")}`;
  } else if ("translate" in value) {
    return `%${value.translate}%${value.with?.map(chat_to_text).join("")}`;
  } else if ("keybind" in value) {
    return `[${value.keybind}]`;
  } else {
    throw new Error("Invalid text component");
  }
};
