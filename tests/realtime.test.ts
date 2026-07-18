import { afterEach, describe, expect, jest, test } from "bun:test";
import { ChattoClient } from "../src/client.js";
import { RealtimeClient } from "../src/realtime/client.js";
import { startMockRealtimeServer, type MockRealtimeServer } from "./mock/realtime-server.js";

let server: MockRealtimeServer | undefined;
let client: RealtimeClient | undefined;

afterEach(async () => {
  client?.close();
  await server?.stop();
  client = undefined;
  server = undefined;
});

function eventPromise<K extends Parameters<RealtimeClient["addEventListener"]>[0]>(
  target: RealtimeClient,
  type: K,
): Promise<unknown> {
  return new Promise((resolve) => target.addEventListener(type, resolve as never, { once: true }));
}

describe("RealtimeClient", () => {
  test("is created by ChattoClient with the shared base URL and token", async () => {
    server = startMockRealtimeServer();
    const chatto = new ChattoClient({ baseUrl: server.baseUrl, token: "shared-token" });
    client = chatto.realtime();

    await client.connect();

    expect(server.hellos[0]?.bearerToken).toBe("shared-token");
  });

  test("performs the binary hello and subscribe handshake", async () => {
    server = startMockRealtimeServer();
    client = new RealtimeClient({ baseUrl: server.baseUrl, token: async () => "realtime-token" });
    const opened = eventPromise(client, "open");

    await client.connect();
    const openEvent = await opened as { detail: { serverHello: { protocolVersion: number } } };

    expect(server.hellos[0]?.protocolVersion).toBe(1);
    expect(server.hellos[0]?.bearerToken).toBe("realtime-token");
    expect(server.subscriptionCount).toBe(1);
    expect(openEvent.detail.serverHello.protocolVersion).toBe(1);
    expect(client.state).toBe("open");
  });

  test("dispatches envelope oneof cases with typed event details", async () => {
    server = startMockRealtimeServer();
    client = new RealtimeClient({ baseUrl: server.baseUrl });
    await client.connect();
    const received = new Promise<string>((resolve) => {
      client?.addEventListener("messagePosted", (event) => resolve(event.detail.event.roomId), { once: true });
    });

    server.send({
      frame: {
        case: "event",
        value: {
          id: "realtime-1",
          event: {
            case: "messagePosted",
            value: { roomId: "room-1", messageEventId: "event-1" },
          },
        },
      },
    });

    expect(await received).toBe("room-1");
  });

  test("pings after two missed heartbeat intervals and closes after continued silence", async () => {
    server = startMockRealtimeServer({ heartbeatIntervalSeconds: 1, respondToPing: false });
    client = new RealtimeClient({ baseUrl: server.baseUrl });
    await client.connect();

    jest.useFakeTimers({ now: 0 });
    try {
      const activity = eventPromise(client, "messagePosted");
      server.send({
        frame: {
          case: "event",
          value: {
            id: "heartbeat-activity",
            event: {
              case: "messagePosted",
              value: { roomId: "room-1", messageEventId: "event-1" },
            },
          },
        },
      });
      await activity;
      const closed = eventPromise(client, "close");
      const send = jest.spyOn(WebSocket.prototype, "send");

      try {
        jest.advanceTimersByTime(2_000);
        expect(send).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1_000);
        const closeEvent = await closed as { detail: { code: string } };

        expect(closeEvent.detail.code).toBe("heartbeat_timeout");
        expect(client.state).toBe("closed");
      } finally {
        send.mockRestore();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  test("exposes server close hints and allows a manual reconnect", async () => {
    server = startMockRealtimeServer();
    client = new RealtimeClient({ baseUrl: server.baseUrl });
    await client.connect();
    const closed = eventPromise(client, "close");

    server.send({
      frame: {
        case: "close",
        value: { code: "maintenance", message: "restart", reconnect: true, retryAfterMs: 2500 },
      },
    });
    const closeEvent = await closed as { detail: { reconnect: boolean; retryAfterMs: number; code: string } };

    expect(closeEvent.detail).toMatchObject({ reconnect: true, retryAfterMs: 2500, code: "maintenance" });
    await client.connect();
    expect(server.hellos).toHaveLength(2);
  });

  test("surfaces a fatal protocol error and closes", async () => {
    server = startMockRealtimeServer();
    client = new RealtimeClient({ baseUrl: server.baseUrl });
    await client.connect();
    const errored = eventPromise(client, "error");
    const closed = eventPromise(client, "close");

    server.send({
      frame: {
        case: "error",
        value: { code: "permission_denied", message: "revoked", fatal: true },
      },
    });

    const errorEvent = await errored as { detail: { protocolError: { code: string; fatal: boolean } } };
    await closed;
    expect(errorEvent.detail.protocolError).toMatchObject({ code: "permission_denied", fatal: true });
  });
});
