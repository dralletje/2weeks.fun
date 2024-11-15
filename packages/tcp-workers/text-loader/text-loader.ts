export async function load(specifier: string, context, nextLoad) {
  if (context.importAttributes?.type !== "text") {
    return nextLoad(specifier, context);
  }

  let url = new URL(specifier);
  let pathname = url.pathname;

  let source = `
import fs from "fs/promises";

export default await fs.readFile(${JSON.stringify(pathname)}, "utf8");
`;
  return {
    format: "module",
    shortCircuit: true,
    source: source,
  };
}
