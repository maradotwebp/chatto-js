import type { Interceptor } from "@connectrpc/connect";

/**
 * Supplies the opaque bearer token used to authenticate Chatto requests.
 *
 * A function provider is evaluated for every request, which allows callers to
 * read a refreshed token without rebuilding the client. Chatto tokens are
 * opaque and must not be decoded as JWTs.
 */
export type TokenProvider = string | (() => string | Promise<string>);

/**
 * Creates a Connect interceptor that adds an `Authorization: Bearer` header.
 *
 * The interceptor leaves the header unset when the provider returns an empty
 * string. Provider failures reject the RPC without retrying it.
 *
 * @param token - Static token or function evaluated immediately before each RPC.
 * @returns A Connect interceptor suitable for a transport's interceptor list.
 *
 * @example
 * ```ts
 * import { createConnectTransport } from "@connectrpc/connect-web";
 * import { createAuthInterceptor } from "chatto.js";
 *
 * const transport = createConnectTransport({
 *   baseUrl: "https://chat.example.com/api/connect",
 *   interceptors: [createAuthInterceptor(() => tokenStore.current())],
 * });
 * ```
 */
export function createAuthInterceptor(token: TokenProvider): Interceptor {
  return (next) => async (request) => {
    const value = typeof token === "function" ? await token() : token;
    if (value) request.header.set("Authorization", `Bearer ${value}`);
    return next(request);
  };
}
