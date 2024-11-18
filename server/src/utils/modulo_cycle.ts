export function modulo_cycle(n: number, m: number): number;
export function modulo_cycle(n: bigint, m: bigint): bigint;
export function modulo_cycle(n: any, m: any): any {
  return ((n % m) + m) % m;
}
