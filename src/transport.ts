import type { Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { createAuthInterceptor } from "./auth.js";
import type { ChattoClientOptions } from "./client.js";

/**
 * Reduces a supported Chatto base URL to its origin.
 *
 * @param baseUrl - Server origin or an origin ending in `/api/connect`.
 * @returns The normalized URL origin without a trailing slash.
 * @throws {@link TypeError} If the URL contains credentials, a query, a
 * fragment, or a path other than `/api/connect`.
 * @internal
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
 * @internal
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
 * @internal
 */
export function createChattoTransport(options: ChattoClientOptions): Transport {
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
