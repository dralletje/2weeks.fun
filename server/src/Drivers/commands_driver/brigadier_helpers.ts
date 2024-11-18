import { groupBy, isEqual, range, zip } from "lodash-es";
import {
  type BrigadierParser,
  type BrigadierNode,
  type BrigadierSuggestionType,
} from "../../protocol/brigadier.ts";

export type NestedBrigadierNode =
  | { type: "root"; children: Array<NestedBrigadierNode> }
  | {
      type: "literal";
      name: string;
      is_executable: boolean;
      children: Array<NestedBrigadierNode>;
    }
  | {
      type: "argument";
      name: string;
      is_executable: boolean;
      children: Array<NestedBrigadierNode>;
      parser: BrigadierParser;
      suggestion_type?: BrigadierSuggestionType;
    };

class VeryMutableCollector {
  private nodes = new Map<number, BrigadierNode>();
  private ids = new Map<NestedBrigadierNode, number>();
  private last_index = 0;

  add(node: NestedBrigadierNode): number {
    if (this.ids.has(node)) {
      return this.ids.get(node)!;
    }

    let id = this.last_index;
    this.ids.set(node, id);
    this.last_index += 1;

    if (node.type === "root") {
      let ids = node.children.map((child) => this.add(child));
      this.nodes.set(id, {
        type: "root",
        children: ids,
      });
    } else if (node.type === "literal") {
      this.nodes.set(id, {
        type: "literal",
        name: node.name,
        is_executable: node.is_executable,
        children: node.children.map((child) => this.add(child)),
      });
    } else if (node.type === "argument") {
      this.nodes.set(id, {
        type: "argument",
        name: node.name,
        is_executable: node.is_executable,
        children: node.children.map((child) => this.add(child)),
        parser: node.parser,
        suggestion_type: node.suggestion_type,
      });
    } else {
      // @ts-ignore
      throw new Error(`Unknown node type: ${node.type}`);
    }

    return id;
  }

  get(): Array<BrigadierNode> {
    return range(0, this.last_index).map((i) => {
      let node = this.nodes.get(i);
      if (node == null) {
        throw new Error(`Missing node: ${i}`);
      }
      return node;
    });
  }
}

/// TODO Does not handle recursive nodes yet
let merge_nodes = (node: NestedBrigadierNode): NestedBrigadierNode => {
  let new_children: Array<NestedBrigadierNode> = [];

  let grouped: {
    literal?: Array<NestedBrigadierNode & { type: "literal" }>;
    argument?: Array<NestedBrigadierNode & { type: "argument" }>;
  } = groupBy(node.children, (child) => child.type);

  let grouped_literals = groupBy(grouped.literal, (child) => child.name);
  for (let [name, children] of Object.entries(grouped_literals)) {
    new_children.push({
      type: "literal",
      name: name,
      is_executable: children.some((child) => child.is_executable),
      children: children.flatMap((child) => child.children),
    });
  }

  let grouped_arguments: Array<{
    name: string;
    suggestion_type?: BrigadierSuggestionType;
    parser: BrigadierParser;
    group: Array<NestedBrigadierNode & { type: "argument" }>;
  }> = [];
  node_done: for (let node of grouped.argument ?? []) {
    for (let group of grouped_arguments) {
      if (
        group.name === node.name &&
        isEqual(group.parser, node.parser) &&
        isEqual(group.suggestion_type, node.suggestion_type)
      ) {
        group.group.push(node);
        continue node_done;
      }
    }
    grouped_arguments.push({
      name: node.name,
      parser: node.parser,
      suggestion_type: node.suggestion_type,
      group: [node],
    });
  }
  for (let group of grouped_arguments) {
    new_children.push({
      type: "argument",
      name: group.name,
      is_executable: group.group.some((child) => child.is_executable),
      children: group.group.flatMap((child) => child.children),
      parser: group.parser,
      suggestion_type: group.suggestion_type,
    });
  }
  // console.log(`grouped_arguments:`, grouped_arguments);

  // new_children.push(...(grouped.argument ?? []));

  return {
    ...node,
    children: new_children.map(merge_nodes),
  };
};

export let flatten_command_node = (
  root: NestedBrigadierNode
): {
  nodes: Array<BrigadierNode>;
  root_index: number;
} => {
  let merged_root = merge_nodes(root);
  let collector = new VeryMutableCollector();
  let id = collector.add(merged_root);

  return {
    nodes: collector.get(),
    root_index: id,
  };
};
