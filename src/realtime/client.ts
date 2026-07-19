import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  RealtimeClientFrameSchema,
  RealtimeServerFrameSchema,
  type RealtimeClose,
  type RealtimeServerHello,
} from "../gen/chatto/realtime/v1/realtime_pb.js";
import type { TokenProvider } from "../auth.js";
import { normalizeChattoBaseUrl } from "../transport.js";
import type {
  RealtimeEventListener,
  RealtimeEventListenerOptions,
  RealtimeEventMap,
  RealtimeEventType,
} from "./events.js";

/** Observable lifecycle state of a {@link RealtimeClient}. */
export type RealtimeClientState = "idle" | "connecting" | "open" | "closed";

/**
 * Minimal WebSocket contract required by {@link RealtimeClient}.
 *
 * The standard browser, Bun, and Node.js 22 WebSocket implementations satisfy
 * this shape. Custom implementations must deliver binary messages through
 * `MessageEvent.data` and support `binaryType = "arraybuffer"`.
 */
export interface WebSocketLike {
  /** Preferred representation for incoming binary frames. */
  binaryType: BinaryType;

  /** Current WebSocket ready-state numeric value. */
  readonly readyState: number;

  /** Sends a text or binary WebSocket frame. Chatto uses binary frames only. */
  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void;

  /** Starts the WebSocket closing handshake. */
  close(code?: number, reason?: string): void;

  /** Registers a listener for `open`, `message`, `error`, or `close`. */
  addEventListener(type: string, listener: (event: any) => void): void;
}

/**
 * Creates the WebSocket instance used for one realtime connection attempt.
 */
export type WebSocketFactory = (url: string) => WebSocketLike;

/** Configures a {@link RealtimeClient} connection and its runtime dependencies. */
export interface RealtimeClientOptions {
  /** Chatto server origin, optionally ending in `/api/connect`. */
  readonly baseUrl: string;

  /** Opaque bearer token or provider evaluated during each connection handshake. */
  readonly token?: TokenProvider | undefined;

  /**
   * WebSocket constructor override.
   *
  * @defaultValue The global `WebSocket` constructor.
  */
  readonly webSocketFactory?: WebSocketFactory | undefined;
}

interface StoredListener {
  readonly callback: (event: RealtimeEventMap[RealtimeEventType]) => void;
  readonly once: boolean;
}

/**
 * Maintains Chatto's live-only binary-protobuf realtime subscription.
 *
 * The client performs the protocol hello and subscription handshake, dispatches
 * strongly typed envelope events, and enforces liveness using the heartbeat
 * interval negotiated with the server. It never reconnects automatically;
 * consumers decide when to call {@link RealtimeClient.connect} again and
 * rehydrate durable state through `ChattoClient` RPC services.
 *
 * @example
 * ```ts
 * import { RealtimeClient } from "chatto-js";
 *
 * const realtime = new RealtimeClient({
 *   baseUrl: "https://chat.example.com",
 *   token: "opaque-access-token",
 * });
 *
 * realtime.addEventListener("messagePosted", ({ detail }) => {
 *   console.log(detail.envelope.id, detail.event.messageEventId);
 * });
 * realtime.addEventListener("close", ({ detail }) => {
 *   console.log(detail.reconnect, detail.retryAfterMs);
 * });
 *
 * await realtime.connect();
 * ```
 */
export class RealtimeClient {
  readonly #options: RealtimeClientOptions;
  readonly #listeners = new Map<RealtimeEventType, Set<StoredListener>>();
  #socket: WebSocketLike | undefined;
  #state: RealtimeClientState = "idle";
  #connectPromise: Promise<void> | undefined;
  #resolveConnect: (() => void) | undefined;
  #rejectConnect: ((reason: unknown) => void) | undefined;
  #watchdog: ReturnType<typeof globalThis.setTimeout> | undefined;
  #lastActivity = 0;
  #heartbeatIntervalMs = 0;
  #pingOutstanding = false;
  #pingSequence = 0;
  #manualClose = false;
  #closeHint: RealtimeClose | undefined;
  #serverHello: RealtimeServerHello | undefined;

  /**
   * Creates a disconnected realtime client.
   *
   * @param options - Server URL, authentication, and optional runtime adapters.
   */
  constructor(options: RealtimeClientOptions) {
    this.#options = options;
  }

  /**
   * Current connection lifecycle state.
   *
   * The state becomes `open` only after Chatto confirms the event subscription,
   * not merely when the underlying WebSocket opens.
   */
  get state(): RealtimeClientState {
    return this.#state;
  }

  /**
   * Registers a strongly typed data or lifecycle event listener.
   *
   * @typeParam K - Event name, inferred from `type`.
   * @param type - Envelope oneof case or `open`, `close`, or `error`.
   * @param listener - Callback receiving the event type mapped to `type`.
   * @param options - Listener registration behavior.
   *
   * @example
   * ```ts
   * realtime.addEventListener("reactionAdded", ({ detail }) => {
   *   console.log(detail.event.messageEventId, detail.event.emoji);
   * }, { once: true });
   * ```
   */
  addEventListener<K extends RealtimeEventType>(
    type: K,
    listener: RealtimeEventListener<K>,
    options: RealtimeEventListenerOptions = {},
  ): void {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add({
      callback: listener as (event: RealtimeEventMap[RealtimeEventType]) => void,
      once: options.once ?? false,
    });
  }

  /**
   * Removes registrations that use the same event name and callback reference.
   *
   * @typeParam K - Event name, inferred from `type`.
   * @param type - Event name used during registration.
   * @param listener - Original listener reference passed to {@link RealtimeClient.addEventListener}.
   *
   * @example
   * ```ts
   * const onTyping: RealtimeEventListener<"userTyping"> = ({ detail }) => {
   *   console.log(detail.event.roomId);
   * };
   * realtime.addEventListener("userTyping", onTyping);
   * realtime.removeEventListener("userTyping", onTyping);
   * ```
   */
  removeEventListener<K extends RealtimeEventType>(type: K, listener: RealtimeEventListener<K>): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    for (const stored of listeners) {
      if (stored.callback === listener) listeners.delete(stored);
    }
    if (listeners.size === 0) this.#listeners.delete(type);
  }

  /**
   * Opens the WebSocket and completes the Chatto hello/subscription handshake.
   *
   * Calling this method while connecting returns the existing connection
   * promise; calling it while open resolves immediately. After a close, calling
   * it again starts a fresh connection. No automatic retry or state replay is
   * performed.
   *
   * @returns A promise that resolves after the server sends `subscribed`.
   * @throws If socket construction, token resolution, protocol decoding, or the
   * handshake fails before subscription.
   *
   * @example
   * ```ts
   * await realtime.connect();
   * console.log(realtime.state); // "open"
   * ```
   */
  async connect(): Promise<void> {
    if (this.#state === "open") return;
    if (this.#state === "connecting" && this.#connectPromise) return this.#connectPromise;

    this.#clearWatchdog();
    this.#manualClose = false;
    this.#closeHint = undefined;
    this.#serverHello = undefined;
    this.#pingOutstanding = false;
    this.#state = "connecting";

    const webSocketUrl = new URL("/api/realtime", normalizeChattoBaseUrl(this.#options.baseUrl));
    webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
    const factory = this.#options.webSocketFactory ?? ((url: string) => new WebSocket(url) as WebSocketLike);

    this.#connectPromise = new Promise<void>((resolve, reject) => {
      this.#resolveConnect = resolve;
      this.#rejectConnect = reject;
    });

    try {
      const socket = factory(webSocketUrl.href);
      this.#socket = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => void this.#handleSocketOpen(socket));
      socket.addEventListener("message", (event: MessageEvent<unknown>) => void this.#handleMessage(socket, event.data));
      socket.addEventListener("error", (event: Event) => this.#handleSocketError(socket, event));
      socket.addEventListener("close", (event: CloseEvent) => this.#handleSocketClose(socket, event));
    } catch (error) {
      this.#state = "closed";
      this.#rejectConnect?.(error);
      this.#emit("error", { type: "error", detail: { cause: error } });
    }

    return this.#connectPromise;
  }

  /**
   * Starts a clean client-requested shutdown and stops the heartbeat watchdog.
   *
   * When a socket is active, the resulting `close` event uses the stable
   * `client_closed` code and does not recommend reconnection.
   *
   * @example
   * ```ts
   * realtime.close();
   * ```
   */
  close(): void {
    this.#manualClose = true;
    this.#closeHint = createCloseHint("client_closed", "Closed by client", false, 0);
    this.#clearWatchdog();
    if (this.#socket && this.#socket.readyState < 2) {
      this.#socket.close(1000);
    } else {
      this.#state = "closed";
    }
  }

  async #handleSocketOpen(socket: WebSocketLike): Promise<void> {
    if (socket !== this.#socket) return;
    try {
      const token = this.#options.token;
      const bearerToken = typeof token === "function" ? await token() : token;
      if (socket !== this.#socket) return;
      this.#send({
        frame: {
          case: "hello",
          value: {
            protocolVersion: 1,
            ...(bearerToken === undefined ? {} : { bearerToken }),
          },
        },
      });
    } catch (error) {
      this.#emit("error", { type: "error", detail: { cause: error } });
      this.#rejectConnect?.(error);
      this.#closeHint = createCloseHint("token_provider_failed", "Token provider failed", false, 0);
      socket.close(4000);
    }
  }

  async #handleMessage(socket: WebSocketLike, data: unknown): Promise<void> {
    if (socket !== this.#socket) return;
    try {
      const bytes = await binaryData(data);
      const serverFrame = fromBinary(RealtimeServerFrameSchema, bytes);
      switch (serverFrame.frame.case) {
        case "hello": {
          const hello = serverFrame.frame.value;
          if (hello.protocolVersion !== 1) {
            throw new Error(`Unsupported realtime protocol version ${hello.protocolVersion}`);
          }
          this.#serverHello = hello;
          this.#heartbeatIntervalMs = hello.heartbeatIntervalSeconds * 1_000;
          this.#markActivity();
          this.#send({ frame: { case: "subscribeEvents", value: {} } });
          break;
        }
        case "subscribed":
          if (!this.#serverHello) throw new Error("Received subscribed before server hello");
          this.#state = "open";
          this.#resolveConnect?.();
          this.#resolveConnect = undefined;
          this.#rejectConnect = undefined;
          this.#emit("open", { type: "open", detail: { serverHello: this.#serverHello } });
          break;
        case "event": {
          this.#markActivity();
          const envelope = serverFrame.frame.value;
          if (envelope.event.case !== undefined) {
            const eventCase = envelope.event.case;
            this.#emit(eventCase, {
              type: eventCase,
              detail: { envelope, event: envelope.event.value },
            } as RealtimeEventMap[typeof eventCase]);
          }
          break;
        }
        case "heartbeat":
        case "pong":
          this.#markActivity();
          break;
        case "error": {
          const protocolError = serverFrame.frame.value;
          this.#emit("error", { type: "error", detail: { protocolError } });
          if (protocolError.fatal) {
            this.#closeHint = createCloseHint(protocolError.code, protocolError.message, false, 0);
            socket.close(4000);
          }
          break;
        }
        case "close":
          this.#closeHint = serverFrame.frame.value;
          socket.close(1000);
          break;
      }
    } catch (error) {
      this.#emit("error", { type: "error", detail: { cause: error } });
      this.#rejectConnect?.(error);
      this.#closeHint = createCloseHint("protocol_error", errorMessage(error), false, 0);
      socket.close(4000);
    }
  }

  #handleSocketError(socket: WebSocketLike, cause: Event): void {
    if (socket !== this.#socket) return;
    this.#emit("error", { type: "error", detail: { cause } });
  }

  #handleSocketClose(socket: WebSocketLike, event: CloseEvent): void {
    if (socket !== this.#socket) return;
    this.#clearWatchdog();
    this.#socket = undefined;
    this.#state = "closed";
    if (this.#rejectConnect) this.#rejectConnect(new Error(`Realtime connection closed before subscription (${event.code})`));
    this.#resolveConnect = undefined;
    this.#rejectConnect = undefined;
    this.#connectPromise = undefined;

    const hint = this.#closeHint ?? createCloseHint(
      this.#manualClose ? "client_closed" : "socket_closed",
      event.reason,
      false,
      0,
    );
    this.#emit("close", {
      type: "close",
      detail: {
        code: hint.code,
        message: hint.message,
        reconnect: hint.reconnect,
        retryAfterMs: hint.retryAfterMs,
        nativeCode: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      },
    });
  }

  #markActivity(): void {
    this.#lastActivity = Date.now();
    this.#pingOutstanding = false;
    this.#scheduleWatchdog(this.#heartbeatIntervalMs * 2);
  }

  #scheduleWatchdog(delayMs: number): void {
    this.#clearWatchdog();
    if (this.#heartbeatIntervalMs <= 0) return;
    this.#watchdog = globalThis.setTimeout(() => this.#runWatchdog(), delayMs);
  }

  #runWatchdog(): void {
    this.#watchdog = undefined;
    if (!this.#socket || this.#state === "closed") return;
    const quietFor = Date.now() - this.#lastActivity;
    if (!this.#pingOutstanding && quietFor < this.#heartbeatIntervalMs * 2) {
      this.#scheduleWatchdog(this.#heartbeatIntervalMs * 2 - quietFor);
      return;
    }
    if (!this.#pingOutstanding) {
      this.#pingOutstanding = true;
      this.#send({
        frame: {
          case: "ping",
          value: { nonce: `${Date.now()}-${++this.#pingSequence}` },
        },
      });
      this.#scheduleWatchdog(this.#heartbeatIntervalMs);
      return;
    }

    this.#closeHint = createCloseHint("heartbeat_timeout", "Realtime heartbeat timed out", true, 0);
    this.#socket.close(4001);
  }

  #clearWatchdog(): void {
    if (this.#watchdog !== undefined) {
      globalThis.clearTimeout(this.#watchdog);
      this.#watchdog = undefined;
    }
  }

  #send(frame: Parameters<typeof create<typeof RealtimeClientFrameSchema>>[1]): void {
    if (!this.#socket || this.#socket.readyState !== 1) return;
    this.#socket.send(toBinary(RealtimeClientFrameSchema, create(RealtimeClientFrameSchema, frame)));
  }

  #emit<K extends RealtimeEventType>(type: K, event: RealtimeEventMap[K]): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener.callback(event);
      if (listener.once) listeners.delete(listener);
    }
    if (listeners.size === 0) this.#listeners.delete(type);
  }
}

function createCloseHint(code: string, message: string, reconnect: boolean, retryAfterMs: number): RealtimeClose {
  return {
    $typeName: "chatto.realtime.v1.RealtimeClose",
    code,
    message,
    reconnect,
    retryAfterMs,
  };
}

async function binaryData(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError("Chatto realtime requires binary WebSocket frames");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
