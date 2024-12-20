import type { SocketAddress } from "./types.ts";

export function isSocketAddress(address: unknown): address is SocketAddress {
  return (
    typeof address === "object" &&
    address !== null &&
    Object.hasOwn(address, "hostname") &&
    Object.hasOwn(address, "port")
  );
}
