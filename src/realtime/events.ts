import type {
  RealtimeError,
  RealtimeEventEnvelope,
  RealtimeServerHello,
} from "../gen/chatto/realtime/v1/realtime_pb.js";

/**
 * Union of all populated event oneof selections in a realtime envelope.
 *
 * @example
 * ```ts
 * function inspect(selection: RealtimeEventSelection) {
 *   if (selection.case === "messagePosted") {
 *     console.log(selection.value.messageEventId);
 *   }
 * }
 * ```
 */
export type RealtimeEventSelection = Exclude<RealtimeEventEnvelope["event"], { case: undefined }>;

/**
 * Event names emitted for `RealtimeEventEnvelope` oneof cases.
 *
 * This union is derived from the generated schema, so newly generated protocol
 * cases become available without maintaining a parallel string list.
 *
 * @example
 * ```ts
 * const eventName: RealtimeEventCase = "messagePosted";
 * ```
 */
export type RealtimeEventCase = RealtimeEventSelection["case"];

/**
 * Resolves the generated protobuf payload associated with an event name.
 *
 * @typeParam K - Realtime envelope oneof case.
 *
 * @example
 * ```ts
 * function roomForMessage(event: RealtimeEventValue<"messagePosted">) {
 *   return event.roomId;
 * }
 * ```
 */
export type RealtimeEventValue<K extends RealtimeEventCase> = Extract<RealtimeEventSelection, { case: K }>["value"];

/**
 * Event delivered for a populated realtime envelope oneof case.
 *
 * The compact event-specific payload is available as `detail.event`, while the
 * complete envelope retains its ID, timestamp, and optional actor.
 *
 * @typeParam K - Realtime envelope oneof case.
 *
 * @example
 * ```ts
 * const listener = (event: RealtimeDataEvent<"messagePosted">) => {
 *   console.log(event.detail.envelope.id, event.detail.event.roomId);
 * };
 * ```
 */
export interface RealtimeDataEvent<K extends RealtimeEventCase> {
  /** Envelope oneof case used to register the listener. */
  readonly type: K;

  /** Event payload and its containing realtime envelope. */
  readonly detail: {
    /** Complete envelope containing common event metadata. */
    readonly envelope: RealtimeEventEnvelope;

    /** Event-specific protobuf payload selected by `type`. */
    readonly event: RealtimeEventValue<K>;
  };
}

/**
 * Lifecycle event emitted after the server confirms the event subscription.
 *
 * @example
 * ```ts
 * realtime.addEventListener("open", ({ detail }) => {
 *   console.log(detail.serverHello.serverVersion);
 * });
 * ```
 */
export interface RealtimeOpenEvent {
  /** Lifecycle event name. */
  readonly type: "open";

  /** Negotiated server handshake values. */
  readonly detail: {
    /** Server hello containing protocol version, capabilities, and heartbeat interval. */
    readonly serverHello: RealtimeServerHello;
  };
}

/**
 * Lifecycle event emitted when the underlying WebSocket closes.
 *
 * Protocol-level close guidance and native WebSocket metadata are kept
 * separate. The client never acts on `reconnect` automatically.
 *
 * @example
 * ```ts
 * realtime.addEventListener("close", ({ detail }) => {
 *   if (detail.reconnect) {
 *     scheduleReconnect(detail.retryAfterMs);
 *   }
 * });
 * ```
 */
export interface RealtimeCloseEvent {
  /** Lifecycle event name. */
  readonly type: "close";

  /** Protocol close guidance and native socket details. */
  readonly detail: {
    /** Stable Chatto close code, or a client-generated fallback code. */
    readonly code: string;

    /** Human-readable Chatto close diagnostic. */
    readonly message: string;

    /** Whether the server recommends reconnecting. */
    readonly reconnect: boolean;

    /** Server-suggested delay before reconnecting, in milliseconds. */
    readonly retryAfterMs: number;

    /** Numeric close code reported by the WebSocket implementation. */
    readonly nativeCode: number;

    /** Close reason reported by the WebSocket implementation. */
    readonly reason: string;

    /** Whether the WebSocket implementation considered the close clean. */
    readonly wasClean: boolean;
  };
}

/**
 * Lifecycle event emitted for protocol errors and WebSocket/runtime failures.
 *
 * A server-sent `RealtimeError` is exposed as `protocolError`. Local failures,
 * such as binary decoding or token-provider errors, are exposed as `cause`.
 *
 * @example
 * ```ts
 * realtime.addEventListener("error", ({ detail }) => {
 *   if (detail.protocolError) {
 *     console.error(detail.protocolError.code, detail.protocolError.message);
 *   } else {
 *     console.error(detail.cause);
 *   }
 * });
 * ```
 */
export interface RealtimeErrorEvent {
  /** Lifecycle event name. */
  readonly type: "error";

  /** Server protocol error or local failure cause. */
  readonly detail: {
    /** Structured error frame received from Chatto. */
    readonly protocolError?: RealtimeError | undefined;

    /** Local WebSocket, decoding, or token-provider failure. */
    readonly cause?: unknown;
  };
}

/**
 * Maps every supported event name to its strongly typed listener event.
 *
 * @example
 * ```ts
 * type MessagePostedListener = (event: RealtimeEventMap["messagePosted"]) => void;
 * ```
 */
export type RealtimeEventMap = {
  [K in RealtimeEventCase]: RealtimeDataEvent<K>;
} & {
  open: RealtimeOpenEvent;
  close: RealtimeCloseEvent;
  error: RealtimeErrorEvent;
};

/**
 * Union of realtime envelope cases and lifecycle event names.
 *
 * @example
 * ```ts
 * const lifecycleEvent: RealtimeEventType = "close";
 * const dataEvent: RealtimeEventType = "reactionAdded";
 * ```
 */
export type RealtimeEventType = keyof RealtimeEventMap;

/**
 * Strongly typed callback for one realtime event name.
 *
 * @typeParam K - Data or lifecycle event name.
 *
 * @example
 * ```ts
 * const onTyping: RealtimeEventListener<"userTyping"> = ({ detail }) => {
 *   console.log(detail.event.roomId);
 * };
 * ```
 */
export type RealtimeEventListener<K extends RealtimeEventType> = (event: RealtimeEventMap[K]) => void;

/**
 * Controls registration of a realtime event listener.
 *
 * @example
 * ```ts
 * realtime.addEventListener("open", onOpen, { once: true });
 * ```
 */
export interface RealtimeEventListenerOptions {
  /**
   * Remove the listener after its first invocation.
   *
   * @defaultValue `false`
   */
  readonly once?: boolean;
}
