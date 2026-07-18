import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import {
  RealtimeClientFrameSchema,
  RealtimeServerFrameSchema,
  type RealtimeClientFrame,
} from "../../src/gen/chatto/realtime/v1/realtime_pb.js";

interface SocketData {}

export interface MockRealtimeServerOptions {
  readonly heartbeatIntervalSeconds?: number;
  readonly respondToPing?: boolean;
}

export interface MockRealtimeServer {
  readonly baseUrl: string;
  readonly clientFrames: RealtimeClientFrame[];
  readonly hellos: Extract<RealtimeClientFrame["frame"], { case: "hello" }>["value"][];
  readonly pings: Extract<RealtimeClientFrame["frame"], { case: "ping" }>["value"][];
  readonly subscriptionCount: number;
  send(frame: MessageInitShape<typeof RealtimeServerFrameSchema>): void;
  closeSockets(code?: number, reason?: string): void;
  stop(): Promise<void>;
}

export function startMockRealtimeServer(options: MockRealtimeServerOptions = {}): MockRealtimeServer {
  const clientFrames: RealtimeClientFrame[] = [];
  const hellos: MockRealtimeServer["hellos"] = [];
  const pings: MockRealtimeServer["pings"] = [];
  const sockets = new Set<Bun.ServerWebSocket<SocketData>>();
  let subscriptionCount = 0;

  function send(socket: Bun.ServerWebSocket<SocketData>, frame: MessageInitShape<typeof RealtimeServerFrameSchema>): void {
    socket.send(toBinary(RealtimeServerFrameSchema, create(RealtimeServerFrameSchema, frame)));
  }

  const server = Bun.serve<SocketData>({
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname !== "/api/realtime") return new Response("not found", { status: 404 });
      if (server.upgrade(request, { data: {} })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
      },
      message(socket, data) {
        if (typeof data === "string") {
          socket.close(1003, "binary frames required");
          return;
        }
        const frame = fromBinary(RealtimeClientFrameSchema, data);
        clientFrames.push(frame);
        switch (frame.frame.case) {
          case "hello":
            hellos.push(frame.frame.value);
            send(socket, {
              frame: {
                case: "hello",
                value: {
                  protocolVersion: 1,
                  serverVersion: "v0.4.13",
                  heartbeatIntervalSeconds: options.heartbeatIntervalSeconds ?? 30,
                  capabilities: ["chatto.realtime.events.live.v1", "chatto.realtime.heartbeat.v1", "chatto.realtime.ping.v1"],
                },
              },
            });
            break;
          case "subscribeEvents":
            subscriptionCount += 1;
            send(socket, { frame: { case: "subscribed", value: {} } });
            break;
          case "ping":
            pings.push(frame.frame.value);
            if (options.respondToPing ?? true) {
              send(socket, { frame: { case: "pong", value: { nonce: frame.frame.value.nonce } } });
            }
            break;
        }
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });

  return {
    baseUrl: `http://${server.hostname}:${server.port}`,
    clientFrames,
    hellos,
    pings,
    get subscriptionCount() { return subscriptionCount; },
    send(frame) {
      for (const socket of sockets) send(socket, frame);
    },
    closeSockets(code = 1000, reason = "") {
      for (const socket of sockets) socket.close(code, reason);
    },
    async stop() {
      await Bun.sleep(100);
      for (const socket of sockets) socket.close(1000);
      const deadline = performance.now() + 1_000;
      while (sockets.size > 0 && performance.now() < deadline) await Bun.sleep(5);
      for (const socket of sockets) socket.terminate();
      await Bun.sleep(50);
      await server.stop(true);
    },
  };
}
