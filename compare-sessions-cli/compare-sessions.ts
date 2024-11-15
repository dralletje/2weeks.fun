import fs from "node:fs/promises";
import chalk from "chalk";
import { chunk, zip } from "lodash-es";

let argv = process.argv.slice(2);
let [file1, file2] = argv;

type Packet = {
  direction: "serverbound" | "clientbound";
  packet_name: string;
  packet: string;
};

let data_a = JSON.parse(await fs.readFile(file1, "utf8")) as Array<Packet>;
let data_b = JSON.parse(await fs.readFile(file2, "utf8")) as Array<Packet>;

/// Remove serverbound packets
data_a = data_a.filter((packet) => packet.direction === "clientbound");
data_b = data_b.filter((packet) => packet.direction === "clientbound");

let i = -1;

while (true) {
  i += 1;

  let packet_a = data_a[i];
  let packet_b = data_b[i];

  let _prefix = `${i.toString().padStart(2)}`;
  let prefix = chalk.gray(_prefix);
  let indent = " ".repeat(_prefix.length);

  if (packet_a == null && packet_b == null) {
    break;
  }

  if (packet_a == null) {
    console.log(prefix, chalk.red("PACKET A IS NULL"));
    continue;
  } else if (packet_b == null) {
    let hex_a = chunk(packet_a.packet.replaceAll(/[^a-zA-Z0-9]/g, ""), 2).map(
      (x) => x.join("")
    );
    let lines_a = chunk(hex_a, 20);

    console.log(prefix, chalk.green(packet_a.packet_name));
    for (let line_a of lines_a) {
      console.log(indent, chalk.gray(line_a.join(" ")));
    }
    console.log(indent, chalk.bgRed(" Packet B is empty "));

    continue;
  }

  if (packet_a.packet_name !== packet_b.packet_name) {
    console.log(prefix, "PACKET NAMES DON'T MATCH");
    break;
  }

  console.log(prefix, chalk.green(packet_a.packet_name));

  if (packet_a.packet !== packet_b.packet) {
    let hex_a = chunk(packet_a.packet.replaceAll(/[^a-zA-Z0-9]/g, ""), 2).map(
      (x) => x.join("")
    );
    let hex_b = chunk(packet_b.packet.replaceAll(/[^a-zA-Z0-9]/g, ""), 2).map(
      (x) => x.join("")
    );

    if (hex_a.length > 200) {
      console.log(indent, chalk.red("PACKET TOO LONG TO SHOW DIFF"));
    } else {
      let lines_a = chunk(hex_a, 20);
      let lines_b = chunk(hex_b, 20);

      for (let [line_a, line_b] of zip(lines_a, lines_b)) {
        let line_a_str = (line_a ?? []).join(" ");
        let line_b_str = (line_b ?? []).join(" ");

        if (line_a_str === line_b_str) {
          console.log(indent, chalk.gray(line_a_str));
        } else {
          let chars_a = line_a_str.split(" ");
          let chars_b = line_b_str.split(" ");

          let output_a: Array<string> = [];
          let output_b: Array<string> = [];

          for (let [char_a, char_b] of zip(chars_a, chars_b)) {
            if (char_a === char_b) {
              output_a.push(chalk.gray(char_a));
              output_b.push(chalk.gray(char_b));
            } else {
              output_a.push(chalk.green(char_a));
              output_b.push(chalk.red(char_b));
            }
          }
          console.log(indent, output_a.join(" "));
          console.log(indent, output_b.join(" "));
        }
      }
    }
  }
}
