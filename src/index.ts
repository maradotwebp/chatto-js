/**
 * Thin TypeScript client for Chatto's ConnectRPC and realtime APIs.
 *
 * Start with {@link ChattoClient} for shared authentication and lazy access to
 * all generated public and administrative service clients. Generated protobuf
 * schemas and message types are available through `chatto.js/gen/*` exports.
 *
 * @example
 * ```ts
 * import { ChattoClient } from "chatto.js";
 *
 * const chatto = new ChattoClient({
 *   baseUrl: "https://chat.example.com",
 *   token: "opaque-access-token",
 * });
 *
 * const server = await chatto.discovery.getServer({});
 * console.log(server.profile?.name);
 * ```
 *
 * @packageDocumentation
 */
export { Code, ConnectError } from "@connectrpc/connect";
export { createAuthInterceptor, type TokenProvider } from "./auth.js";
export { ChattoAdminClient, ChattoClient, type ChattoClientOptions } from "./client.js";
export {
  RealtimeClient,
  type RealtimeClientOptions,
  type RealtimeClientState,
  type WebSocketFactory,
  type WebSocketLike,
} from "./realtime/client.js";
export type {
  RealtimeCloseEvent,
  RealtimeDataEvent,
  RealtimeErrorEvent,
  RealtimeEventCase,
  RealtimeEventListener,
  RealtimeEventListenerOptions,
  RealtimeEventMap,
  RealtimeEventSelection,
  RealtimeEventType,
  RealtimeEventValue,
  RealtimeOpenEvent,
} from "./realtime/events.js";
export { CHATTO_PROTOCOL_TAG, VERSION } from "./version.js";
