import { meanBy } from "lodash-es";

export function modulo_cycle_safe(n: any): any {
  return ((n % 16) + 16) % 16;
}

export function modulo_cycle_1(n: any): any {
  return n & 0b1111;
}

export function modulo_cycle_2(n: any): any {
  let x = n % 16;
  return x < 0 ? x + 16 : x;
}

let benchmark = (fn) => {
  let results: Array<{ time: number }> = [];

  let TOTAL_TIME_TO_SPEND = 1000;
  let start = Date.now();

  while (Date.now() - start < TOTAL_TIME_TO_SPEND) {
    let start = Date.now();
    fn();
    let end = Date.now();
    results.push({ time: end - start });
  }

  console.log(`results.length:`, results.length);
  return meanBy(results, (x) => x.time);
};

let n = 50000;

let benchmarks = [
  {
    name: "Double modulo",
    time: benchmark(() => {
      for (let i = -n; i < n; i++) {
        modulo_cycle_safe(i);
      }
    }),
  },
  {
    name: "Bitwise",
    time: benchmark(() => {
      for (let i = -n; i < n; i++) {
        modulo_cycle_1(i);
      }
    }),
  },
  {
    name: "Modulo + if",
    time: benchmark(() => {
      for (let i = -n; i < n; i++) {
        modulo_cycle_2(i);
      }
    }),
  },
];

console.log(`npm:`, benchmarks);
