import { afterEach, describe, expect, test } from "bun:test";
import { AdminDiagnosticsService } from "../src/gen/chatto/admin/v1/diagnostics_pb.js";
import { MessageService } from "../src/gen/chatto/api/v1/messages_pb.js";
import { ServerDiscoveryService } from "../src/gen/chatto/discovery/v1/server_pb.js";
import { ChattoClient } from "../src/client.js";
import { startMockConnectServer, type MockConnectServer } from "./mock/connect-server.js";

let server: MockConnectServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("ChattoClient", () => {
  test("round-trips discovery and message RPCs", async () => {
    server = startMockConnectServer();
    server.route(ServerDiscoveryService, "getServer", () => ({
      profile: { name: "Mock Chatto", version: "v0.4.13" },
    }));
    server.route(MessageService, "createMessage", (input) => {
      const request = input as typeof input & { roomId: string; body: string };
      return { message: { id: "event-1", roomId: request.roomId, actorId: "user-1", body: request.body } };
    });
    server.route(MessageService, "getMessage", (input) => {
      const request = input as typeof input & { roomId: string; eventId: string };
      return { message: { id: request.eventId, roomId: request.roomId, actorId: "user-1", body: "hello" } };
    });
    const client = new ChattoClient({ baseUrl: server.baseUrl, token: "test-token" });

    const discovery = await client.discovery.getServer({});
    const created = await client.messages.createMessage({ roomId: "room-1", body: "hello" });
    const fetched = await client.messages.getMessage({ roomId: "room-1", eventId: "event-1" });

    expect(discovery.profile?.name).toBe("Mock Chatto");
    expect(created.message?.id).toBe("event-1");
    expect(fetched.message?.body).toBe("hello");
  });

  test("exposes an admin RPC", async () => {
    server = startMockConnectServer();
    server.route(AdminDiagnosticsService, "getSystemInfo", () => ({}));
    const client = new ChattoClient({ baseUrl: server.baseUrl });

    await client.admin.diagnostics.getSystemInfo({});

    expect(server.requests[0]?.path).toBe(
      "/api/connect/chatto.admin.v1.AdminDiagnosticsService/GetSystemInfo",
    );
  });

  test("creates service accessors lazily and caches them", () => {
    const client = new ChattoClient({ baseUrl: "https://chat.example" });

    expect(client.discovery).toBe(client.discovery);
    expect(client.messages).toBe(client.messages);
    expect(client.admin.users).toBe(client.admin.users);
    expect(client.discovery).not.toBe(client.messages);
  });
});
