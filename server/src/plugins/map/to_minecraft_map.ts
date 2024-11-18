/// https://observablehq.com/@dralletje/minecraft-map-maker
let COLORS_FROM_WIKI = `[{"color":{"r":127,"g":178,"b":56},"number":1,"name":"GRASS"},{"color":{"r":247,"g":233,"b":163},"number":2,"name":"SAND"},{"color":{"r":199,"g":199,"b":199},"number":3,"name":"WOOL"},{"color":{"r":255,"g":0,"b":0},"number":4,"name":"FIRE"},{"color":{"r":160,"g":160,"b":255},"number":5,"name":"ICE"},{"color":{"r":167,"g":167,"b":167},"number":6,"name":"METAL"},{"color":{"r":0,"g":124,"b":0},"number":7,"name":"PLANT"},{"color":{"r":255,"g":255,"b":255},"number":8,"name":"SNOW"},{"color":{"r":164,"g":168,"b":184},"number":9,"name":"CLAY"},{"color":{"r":151,"g":109,"b":77},"number":10,"name":"DIRT"},{"color":{"r":112,"g":112,"b":112},"number":11,"name":"STONE"},{"color":{"r":64,"g":64,"b":255},"number":12,"name":"WATER"},{"color":{"r":143,"g":119,"b":72},"number":13,"name":"WOOD"},{"color":{"r":255,"g":252,"b":245},"number":14,"name":"QUARTZ"},{"color":{"r":216,"g":127,"b":51},"number":15,"name":"COLOR_ORANGE"},{"color":{"r":178,"g":76,"b":216},"number":16,"name":"COLOR_MAGENTA"},{"color":{"r":102,"g":153,"b":216},"number":17,"name":"COLOR_LIGHT_BLUE"},{"color":{"r":229,"g":229,"b":51},"number":18,"name":"COLOR_YELLOW"},{"color":{"r":127,"g":204,"b":25},"number":19,"name":"COLOR_LIGHT_GREEN"},{"color":{"r":242,"g":127,"b":165},"number":20,"name":"COLOR_PINK"},{"color":{"r":76,"g":76,"b":76},"number":21,"name":"COLOR_GRAY"},{"color":{"r":153,"g":153,"b":153},"number":22,"name":"COLOR_LIGHT_GRAY"},{"color":{"r":76,"g":127,"b":153},"number":23,"name":"COLOR_CYAN"},{"color":{"r":127,"g":63,"b":178},"number":24,"name":"COLOR_PURPLE"},{"color":{"r":51,"g":76,"b":178},"number":25,"name":"COLOR_BLUE"},{"color":{"r":102,"g":76,"b":51},"number":26,"name":"COLOR_BROWN"},{"color":{"r":102,"g":127,"b":51},"number":27,"name":"COLOR_GREEN"},{"color":{"r":153,"g":51,"b":51},"number":28,"name":"COLOR_RED"},{"color":{"r":25,"g":25,"b":25},"number":29,"name":"COLOR_BLACK"},{"color":{"r":250,"g":238,"b":77},"number":30,"name":"GOLD"},{"color":{"r":92,"g":219,"b":213},"number":31,"name":"DIAMOND"},{"color":{"r":74,"g":128,"b":255},"number":32,"name":"LAPIS"},{"color":{"r":0,"g":217,"b":58},"number":33,"name":"EMERALD"},{"color":{"r":129,"g":86,"b":49},"number":34,"name":"PODZOL"},{"color":{"r":112,"g":2,"b":0},"number":35,"name":"NETHER"},{"color":{"r":209,"g":177,"b":161},"number":36,"name":"TERRACOTTA_WHITE"},{"color":{"r":159,"g":82,"b":36},"number":37,"name":"TERRACOTTA_ORANGE"},{"color":{"r":149,"g":87,"b":108},"number":38,"name":"TERRACOTTA_MAGENTA"},{"color":{"r":112,"g":108,"b":138},"number":39,"name":"TERRACOTTA_LIGHT_BLUE"},{"color":{"r":186,"g":133,"b":36},"number":40,"name":"TERRACOTTA_YELLOW"},{"color":{"r":103,"g":117,"b":53},"number":41,"name":"TERRACOTTA_LIGHT_GREEN"},{"color":{"r":160,"g":77,"b":78},"number":42,"name":"TERRACOTTA_PINK"},{"color":{"r":57,"g":41,"b":35},"number":43,"name":"TERRACOTTA_GRAY"},{"color":{"r":135,"g":107,"b":98},"number":44,"name":"TERRACOTTA_LIGHT_GRAY"},{"color":{"r":87,"g":92,"b":92},"number":45,"name":"TERRACOTTA_CYAN"},{"color":{"r":122,"g":73,"b":88},"number":46,"name":"TERRACOTTA_PURPLE"},{"color":{"r":76,"g":62,"b":92},"number":47,"name":"TERRACOTTA_BLUE"},{"color":{"r":76,"g":50,"b":35},"number":48,"name":"TERRACOTTA_BROWN"},{"color":{"r":76,"g":82,"b":42},"number":49,"name":"TERRACOTTA_GREEN"},{"color":{"r":142,"g":60,"b":46},"number":50,"name":"TERRACOTTA_RED"},{"color":{"r":37,"g":22,"b":16},"number":51,"name":"TERRACOTTA_BLACK"},{"color":{"r":189,"g":48,"b":49},"number":52,"name":"CRIMSON_NYLIUM"},{"color":{"r":148,"g":63,"b":97},"number":53,"name":"CRIMSON_STEM"},{"color":{"r":92,"g":25,"b":29},"number":54,"name":"CRIMSON_HYPHAE"},{"color":{"r":22,"g":126,"b":134},"number":55,"name":"WARPED_NYLIUM"},{"color":{"r":58,"g":142,"b":140},"number":56,"name":"WARPED_STEM"},{"color":{"r":86,"g":44,"b":62},"number":57,"name":"WARPED_HYPHAE"},{"color":{"r":20,"g":180,"b":133},"number":58,"name":"WARPED_WART_BLOCK"},{"color":{"r":100,"g":100,"b":100},"number":59,"name":"DEEPSLATE"},{"color":{"r":216,"g":175,"b":147},"number":60,"name":"RAW_IRON"},{"color":{"r":127,"g":167,"b":150},"number":61,"name":"GLOW_LICHEN"}]`;
/// https://minecraft.wiki/w/Map_item_format#Map_colors
let MORE_COLORS = [0.71, 0.86, 1, 0.53];

let all_colors = (JSON.parse(COLORS_FROM_WIKI) as Array<any>).flatMap(
  (
    { color, number, name },
    i
  ): Array<{
    name: string;
    number: number;
    color: { r: number; g: number; b: number };
  }> => {
    return MORE_COLORS.map((multiplier, i) => ({
      name: name,
      color: {
        r: Math.floor(color.r * multiplier),
        g: Math.floor(color.g * multiplier),
        b: Math.floor(color.b * multiplier),
      },
      number: number * 4 + i,
    }));
  }
);

let minecraft_colors_as_laba_simple = all_colors.map(({ color, number }) => {
  let rgba = new Colour(Colour.RGBA, [color.r, color.g, color.b, 255]);
  let laba = rgba.convertTo(Colour.LABA);
  return { rgba, laba, number: number };
});

let minecraft_colors_as_laba = minecraft_colors_as_laba_simple.map(
  ({ laba, ...color }) => {
    let closest =
      (min(
        minecraft_colors_as_laba_simple
          .map(({ laba: laba_compare }) => laba_compare.distanceTo(laba))
          .filter((x) => x !== 0)
      ) as number) / 2;
    return { laba, closest, ...color };
  }
);

let color_to_number = (color) => {
  let [r, g, b, a] = color;

  var color = new Colour(Colour.RGBA, [r, g, b, a]).convertTo(Colour.LABA);

  let closest_distance = Infinity;
  let closest_color = minecraft_colors_as_laba[0];

  if (a < 1) {
    return 0;
  }

  if (closest_distance === Infinity) {
    for (let minecraft_color of minecraft_colors_as_laba) {
      let distance = minecraft_color.laba.distanceTo(color);
      if (distance < closest_distance) {
        closest_distance = distance;
        closest_color = minecraft_color;
      }
      if (distance < minecraft_color.closest) {
        // break;
      }
    }
  }

  return closest_color.number;
};

import Colour from "./Colour.ts";
import { min } from "lodash-es";

export let to_minecraft_map = (data: Uint8Array) => {
  if (data.length % 4 !== 0) {
    throw new Error("Invalid data length (not divisible by 4)");
  }

  let new_length = data.length / 4;
  let result = new Uint8Array(new_length);
  for (let i = 0; i < new_length; i += 1) {
    let color = data.subarray(i * 4, i * 4 + 4);
    result[i] = color_to_number(color);
  }
  return result;
};
