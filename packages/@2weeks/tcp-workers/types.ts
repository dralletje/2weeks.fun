import net from "node:net";
import { ReadableStream, WritableStream } from "node:stream/web";

export class Socket {
  #node_socket: net.Socket;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  closed: Promise<void>;

  constructor(node_socket: net.Socket) {
    this.#node_socket = node_socket;

    this.readable = ReadableStream.from(node_socket);
    this.writable = new WritableStream(
      {
        start(controller) {},
        write(chunk, controller) {
          node_socket.write(chunk);
        },
        close() {
          node_socket.end();
        },
        abort(reason) {
          console.error(`stream abort: ${reason}`);
        },
      },
      {
        highWaterMark: 3,
        size: () => 1,
      }
    );

    this.closed = new Promise((resolve) => {
      this.#node_socket.on("close", () => resolve());
    });
    this.close = () => {
      node_socket.end();
      return this.closed;
    };
  }

  close() {
    this.#node_socket.end();
    return this.closed;
  }
}

export type Storage = {
  get(key: string): Promise<any | null>;
  put(key: string, value: any): Promise<void>;
};

export type CronEvent = {
  cron: string;
  type: "scheduled";
  scheduledTime: number;
};

export type WorkerEnv = any;

export type CronContext = {
  storage: Storage;
};

export type App = (
  | {
      ports: Array<number>;
      connect(
        connection: { port: number; socket: Socket },
        env: WorkerEnv
      ): Promise<void>;
    }
  | {}
) &
  (
    | {
        crons: Array<string>;
        scheduled(
          event: CronEvent,
          env: WorkerEnv,
          ctx: CronContext
        ): Promise<void>;
      }
    | {}
  );
