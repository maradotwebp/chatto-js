# chatto-js

A thin, fully typed TypeScript client for [Chatto](https://docs.chatto.run/). It exposes Chatto's complete public and admin ConnectRPC API and its binary-protobuf realtime WebSocket protocol.

The generated API is pinned to Chatto **v0.4.13**. Chatto is pre-1.0, so protocol updates in the 0.x line may require a new `chatto-js` release.

## Install

```sh
bun add chatto-js
```

Node.js 22 or newer, Bun, and modern browsers provide the required `fetch` and `WebSocket` globals. Both are injectable for other runtimes and tests.

## Quick start

```ts
import { ChattoClient } from "chatto-js";

const chatto = new ChattoClient({
  baseUrl: "https://chat.example.com",
  token: "opaque-bearer-token",
});

const created = await chatto.messages.createMessage({
  roomId: "room-id",
  body: "Hello from chatto-js",
});

const realtime = chatto.realtime();
realtime.addEventListener("messagePosted", ({ detail }) => {
  console.log(detail.event.roomId, detail.event.messageEventId);
  // Rehydrate durable state through messages, rooms, or threads as needed.
});
realtime.addEventListener("close", ({ detail }) => {
  console.log(detail.reconnect, detail.retryAfterMs);
});
await realtime.connect();

console.log(created.message?.id);
```

Tokens are opaque strings, not JWTs. Token acquisition and login UX are intentionally out of scope. A token can also be supplied asynchronously:

```ts
const chatto = new ChattoClient({
  baseUrl: "https://chat.example.com",
  token: async () => tokenStore.current(),
});
```

Without a token, RPC requests use browser cookie authentication. The transport uses `credentials: "include"` by default.

## API surface

Service clients are created lazily and cached. Public accessors are:

`discovery`, `externalIdentityAuth`, `assets`, `assetUploads`, `messages`, `account`, `notificationPreferences`, `notifications`, `pushNotifications`, `roles`, `roomDirectory`, `rooms`, `server`, `threads`, `users`, `viewer`, and `calls`.

Administrative services live under `admin`:

```ts
const info = await chatto.admin.diagnostics.getSystemInfo({});
const users = await chatto.admin.users.listMembers({ page: { limit: 50 } });
```

Generated request, response, enum, and message definitions are available through deep exports:

```ts
import type { Message } from "chatto-js/gen/chatto/api/v1/message_types_pb";
```

Connect failures surface as standard `ConnectError` values:

```ts
import { Code, ConnectError } from "chatto-js";

try {
  await chatto.viewer.getViewer({});
} catch (error) {
  if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
    // Refresh or replace the opaque token.
  }
}
```

## Realtime lifecycle

`RealtimeClient` speaks binary protobuf frames only. `connect()` resolves after `hello → subscribe → subscribed` and emits `open`. Every `RealtimeEventEnvelope` oneof case is a strongly typed event name such as `messagePosted`, `reactionAdded`, or `userTyping`.

The client watches the negotiated heartbeat interval. After two silent intervals it sends a protocol ping; if the server remains silent for another interval, it closes with `heartbeat_timeout`. It never retries automatically. Server `RealtimeClose` fields are exposed on the `close` event as `reconnect` and `retryAfterMs` hints.

The stream is live-only. After a disconnect, application code should choose when to call `connect()` again and then rehydrate durable state through ConnectRPC. Call `close()` for a clean shutdown.

Custom transports can be injected without adding retry behavior:

```ts
const chatto = new ChattoClient({
  baseUrl: "https://chat.example.com",
  fetch: customFetch,
});

const realtime = chatto.realtime({
  webSocketFactory: (url) => new CustomWebSocket(url),
});
```

## Protocol generation

The Apache-2.0 public protocol packages are vendored from [`chattocorp/chatto@v0.4.13`](https://github.com/chattocorp/chatto/tree/v0.4.13/proto). Internal `core`, `config`, and Unix-socket-only `operator` packages are not included.

```sh
bun run sync-protos
bun run generate
bun run typecheck
bun test
bun run build
```

`sync-protos` deliberately replaces `proto/` from the pinned GitHub archive. `generate` clears `src/gen/` before running Buf with `--include-imports`, preventing stale generated modules.

## License

`chatto-js` is Apache-2.0. See [NOTICE](NOTICE) for attribution of the vendored Chatto definitions and Protovalidate descriptors.
