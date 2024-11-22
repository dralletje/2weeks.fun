export let regexp = (
  strings: TemplateStringsArray,
  ...interpolations: Array<string | RegExp>
) => {
  let result_source = strings.raw[0];

  let i = 1;
  for (let interpolation of interpolations) {
    if (typeof interpolation === "string") {
      result_source = result_source + escapeRegExp(interpolation);
    } else if (interpolation instanceof RegExp) {
      if (interpolation.flags !== "") {
        // prettier-ignore
        throw new TypeError("Trying to interpolate a RegExp with flags, that's not possible yet")
      } else if (
        !interpolation.source.startsWith("^") ||
        !interpolation.source.endsWith("$")
      ) {
        throw new TypeError(
          "Interpolated RegExp must start with `^` and end with `$`"
        );
      } else {
        result_source = `${result_source}(?:${interpolation.source.slice(1, -1)})`;
      }
    } else {
      // prettier-ignore
      throw new TypeError(`Got ${interpolation} as interpolation, while only strings or RegExps are allowed`);
    }

    result_source += strings.raw[i];
    i = i + 1;
  }
  return new RegExp(result_source);
};

/// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
