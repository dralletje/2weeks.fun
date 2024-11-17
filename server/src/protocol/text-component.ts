import { wrap } from "../protocol.ts";
import { nbt_json } from "./nbt-json.ts";

type TextComponentBase = {
  extra?: Array<TextComponent>;
  color?: string;
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
  | string
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
  encode: (value: TextComponent) => {
    return value;
  },
  decode: (value: any) => {
    return value;
  },
});
