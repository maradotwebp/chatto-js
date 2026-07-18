import { afterEach, describe, expect, test } from "bun:test";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { ServerDiscoveryService } from "../src/gen/chatto/discovery/v1/server_pb.js";
import { createChattoTransport, normalizeConnectBaseUrl } from "../src/transport.js";
import { startMockConnectServer, type MockConnectServer } from "./mock/connect-server.js";

let server: MockConnectServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe("normalizeConnectBaseUrl", () => {
  test.each([
    ["https://chat.example", "https://chat.example/api/connect"],
    ["https://chat.example/", "https://chat.example/api/connect"],
    ["https://chat.example/api/connect", "https://chat.example/api/connect"],
    ["https://chat.example/api/connect/", "https://chat.example/api/connect"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeConnectBaseUrl(input)).toBe(expected);
  });

  test("rejects credentials, query strings, and unrelated paths", () => {
    expect(() => normalizeConnectBaseUrl("https://user:pass@chat.example")).toThrow();
    expect(() => normalizeConnectBaseUrl("https://chat.example?x=1")).toThrow();
    expect(() => normalizeConnectBaseUrl("https://chat.example/custom")).toThrow();
  });
});

describe("createChattoTransport", () => {
  test.each([
    ["static-token", "Bearer static-token"],
    [async () => "async-token", "Bearer async-token"],
    [undefined, null],
  ])("injects the configured token provider", async (token, expectedAuthorization) => {
    server = startMockConnectServer();
    server.route(ServerDiscoveryService, "getServer", () => ({
      profile: { name: "Mock Chatto", version: "v0.4.13" },
    }));
    const client = createClient(ServerDiscoveryService, createChattoTransport({ baseUrl: server.baseUrl, token }));

    await client.getServer({});

    const request = server.requests[0];
    expect(request?.headers.get("authorization")).toBe(expectedAuthorization);
    expect(request?.headers.get("connect-protocol-version")).toBe("1");
  });

  test("uses the injected fetch implementation and includes credentials", async () => {
    server = startMockConnectServer();
    server.route(ServerDiscoveryService, "getServer", () => ({}));
    const calls: RequestInit[] = [];
    const injectedFetch = ((input, init) => {
      calls.push(init ?? {});
      return fetch(input, init);
    }) as typeof fetch;
    const client = createClient(ServerDiscoveryService, createChattoTransport({
      baseUrl: server.baseUrl,
      fetch: injectedFetch,
    }));

    await client.getServer({});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.credentials).toBe("include");
  });

  test.each([
    ["unauthenticated", 401, Code.Unauthenticated],
    ["not_found", 404, Code.NotFound],
  ])("surfaces Connect error %s", async (wireCode, status, expectedCode) => {
    server = startMockConnectServer();
    server.error(ServerDiscoveryService, "getServer", wireCode, "mock failure", status);
    const client = createClient(ServerDiscoveryService, createChattoTransport({ baseUrl: server.baseUrl }));

    const promise = client.getServer({});

    await expect(promise).rejects.toBeInstanceOf(ConnectError);
    await expect(promise).rejects.toMatchObject({ code: expectedCode, rawMessage: "mock failure" });
  });
});
