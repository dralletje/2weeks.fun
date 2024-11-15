export async function load(specifier: string, context, nextLoad) {
  if (context.importAttributes?.type !== "binary") {
    return nextLoad(specifier, context);
  }

  let url = new URL(specifier);
  let pathname = url.pathname;

  let source = `
import fs from "fs/promises";

export default await fs.readFile(${JSON.stringify(pathname)})
`;
  return {
    format: "module",
    shortCircuit: true,
    source: source,
  };
}
