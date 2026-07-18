import type { Interceptor, Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { createAuthInterceptor, type TokenProvider } from "./auth.js";

/**
 * Configures the Connect transport used by `ChattoClient`.
 */
export interface ChattoTransportOptions {
  /**
   * Chatto server origin, optionally ending in `/api/connect`.
   *
   * Credentials, query strings, fragments, and unrelated paths are rejected.
   */
  readonly baseUrl: string;

  /**
   * Opaque bearer token or per-request token provider.
   *
   * Omit this property to authenticate with the browser's Chatto session cookie.
   */
  readonly token?: TokenProvider | undefined;

  /**
   * Fetch implementation used for RPC requests.
   *
   * @defaultValue `globalThis.fetch`
   */
  readonly fetch?: typeof globalThis.fetch | undefined;

  /**
   * Whether Connect should encode request and response bodies as binary protobuf.
   *
   * @defaultValue `false`, which uses Connect's JSON encoding.
   */
  readonly useBinaryFormat?: boolean | undefined;

  /**
   * Fetch credentials mode applied to every RPC.
   *
   * @defaultValue `"include"`
   */
  readonly credentials?: RequestCredentials | undefined;

  /** Additional Connect interceptors applied before requests are sent. */
  readonly interceptors?: Interceptor[] | undefined;
}

/**
 * Reduces a supported Chatto base URL to its origin.
 *
 * @param baseUrl - Server origin or an origin ending in `/api/connect`.
 * @returns The normalized URL origin without a trailing slash.
 * @throws {@link TypeError} If the URL contains credentials, a query, a
 * fragment, or a path other than `/api/connect`.
 *
 * @example
 * ```ts
 * normalizeChattoBaseUrl("https://chat.example.com/api/connect/");
 * // "https://chat.example.com"
 * ```
 */
export function normalizeChattoBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username || url.password) throw new TypeError("Chatto baseUrl must not contain credentials");
  if (url.search || url.hash) throw new TypeError("Chatto baseUrl must not contain a query string or fragment");

  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/api/connect") {
    throw new TypeError("Chatto baseUrl must be an origin or end with /api/connect");
  }
  return url.origin;
}

/**
 * Produces the ConnectRPC base URL for a Chatto server.
 *
 * @param baseUrl - Server origin or existing Chatto Connect base URL.
 * @returns A normalized URL ending in `/api/connect`.
 *
 * @example
 * ```ts
 * normalizeConnectBaseUrl("https://chat.example.com/");
 * // "https://chat.example.com/api/connect"
 * ```
 */
export function normalizeConnectBaseUrl(baseUrl: string): string {
  return `${normalizeChattoBaseUrl(baseUrl)}/api/connect`;
}

/**
 * Creates a thin ConnectRPC transport configured for Chatto.
 *
 * Requests use cookie credentials by default and receive bearer authentication
 * when `token` is provided. The transport does not retry failed requests.
 *
 * @param options - Chatto endpoint, authentication, and transport overrides.
 * @returns A Connect transport usable with `createClient()`.
 * @throws {@link TypeError} If `baseUrl` is invalid or no fetch implementation exists.
 *
 * @example
 * ```ts
 * import { createClient } from "@connectrpc/connect";
 * import { createChattoTransport } from "chatto.js";
 * import { ServerDiscoveryService } from "chatto.js/gen/chatto/discovery/v1/server_pb";
 *
 * const transport = createChattoTransport({
 *   baseUrl: "https://chat.example.com",
 * });
 * const discovery = createClient(ServerDiscoveryService, transport);
 * const server = await discovery.getServer({});
 * ```
 */
export function createChattoTransport(options: ChattoTransportOptions): Transport {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new TypeError("A fetch implementation is required");

  const fetchWithCredentials = ((input, init) => fetchImplementation(input, {
    ...init,
    credentials: options.credentials ?? "include",
  })) as typeof globalThis.fetch;
  const interceptors = [...(options.interceptors ?? [])];
  if (options.token !== undefined) interceptors.push(createAuthInterceptor(options.token));

  return createConnectTransport({
    baseUrl: normalizeConnectBaseUrl(options.baseUrl),
    useBinaryFormat: options.useBinaryFormat ?? false,
    fetch: fetchWithCredentials,
    interceptors,
  });
}
