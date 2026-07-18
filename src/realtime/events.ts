import type {
  RealtimeError,
  RealtimeEventEnvelope,
  RealtimeServerHello,
} from "../gen/chatto/realtime/v1/realtime_pb.js";

/** Union of all populated event oneof selections in a realtime envelope. */
export type RealtimeEventSelection = Exclude<RealtimeEventEnvelope["event"], { case: undefined }>;

/** Event names emitted for `RealtimeEventEnvelope` oneof cases. */
export type RealtimeEventCase = RealtimeEventSelection["case"];

/** Resolves the generated protobuf payload associated with an event name. */
export type RealtimeEventValue<K extends RealtimeEventCase> = Extract<RealtimeEventSelection, { case: K }>["value"];

/** Event delivered for a populated realtime envelope oneof case. */
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

/** Lifecycle event emitted after the server confirms the event subscription. */
export interface RealtimeOpenEvent {
  /** Lifecycle event name. */
  readonly type: "open";

  /** Negotiated server handshake values. */
  readonly detail: {
    /** Server hello containing protocol version, capabilities, and heartbeat interval. */
    readonly serverHello: RealtimeServerHello;
  };
}

/** Lifecycle event emitted when the underlying WebSocket closes. */
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

/** Lifecycle event emitted for protocol errors and WebSocket/runtime failures. */
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

/** Maps every supported event name to its strongly typed listener event. */
export type RealtimeEventMap = {
  [K in RealtimeEventCase]: RealtimeDataEvent<K>;
} & {
  open: RealtimeOpenEvent;
  close: RealtimeCloseEvent;
  error: RealtimeErrorEvent;
};

/** Union of realtime envelope cases and lifecycle event names. */
export type RealtimeEventType = keyof RealtimeEventMap;

/** Strongly typed callback for one realtime event name. */
export type RealtimeEventListener<K extends RealtimeEventType> = (event: RealtimeEventMap[K]) => void;

/** Controls registration of a realtime event listener. */
export interface RealtimeEventListenerOptions {
  /**
   * Remove the listener after its first invocation.
   *
   * @defaultValue `false`
   */
  readonly once?: boolean;
}
