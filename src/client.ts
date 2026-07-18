import { createClient, type Client, type Transport } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";
import { AdminDiagnosticsService } from "./gen/chatto/admin/v1/diagnostics_pb.js";
import { AdminEventLogService } from "./gen/chatto/admin/v1/event_log_pb.js";
import { AdminUserService } from "./gen/chatto/admin/v1/members_pb.js";
import { AdminPermissionService } from "./gen/chatto/admin/v1/permissions_pb.js";
import { AdminRoleService } from "./gen/chatto/admin/v1/roles_pb.js";
import { AdminRoomLayoutService } from "./gen/chatto/admin/v1/room_layout_pb.js";
import { AdminServerService } from "./gen/chatto/admin/v1/server_pb.js";
import { MyAccountService } from "./gen/chatto/api/v1/account_pb.js";
import { AssetUploadService } from "./gen/chatto/api/v1/asset_uploads_pb.js";
import { AssetService } from "./gen/chatto/api/v1/attachments_pb.js";
import { UserService } from "./gen/chatto/api/v1/member_directory_pb.js";
import { MessageService } from "./gen/chatto/api/v1/messages_pb.js";
import { NotificationPreferencesService } from "./gen/chatto/api/v1/notification_preferences_pb.js";
import { NotificationService } from "./gen/chatto/api/v1/notifications_pb.js";
import { PushNotificationService } from "./gen/chatto/api/v1/push_notifications_pb.js";
import { RoleService } from "./gen/chatto/api/v1/roles_pb.js";
import { RoomDirectoryService } from "./gen/chatto/api/v1/room_directory_pb.js";
import { RoomService } from "./gen/chatto/api/v1/rooms_pb.js";
import { ServerService } from "./gen/chatto/api/v1/server_state_pb.js";
import { ThreadService } from "./gen/chatto/api/v1/threads_pb.js";
import { ViewerService } from "./gen/chatto/api/v1/viewer_pb.js";
import { VoiceCallService } from "./gen/chatto/api/v1/voice_calls_pb.js";
import { ExternalIdentityAuthService } from "./gen/chatto/auth/v1/external_identity_auth_pb.js";
import { ServerDiscoveryService } from "./gen/chatto/discovery/v1/server_pb.js";
import { RealtimeClient, type RealtimeClientOptions } from "./realtime/client.js";
import { createChattoTransport, type ChattoTransportOptions } from "./transport.js";

type ServiceClientFactory = <S extends DescService>(service: S) => Client<S>;

/**
 * Groups Chatto's permission-gated administrative service clients.
 *
 * Instances are exposed through {@link ChattoClient.admin}; applications do
 * not normally construct this class directly. Each service client is created
 * on first access and then cached.
 */
export class ChattoAdminClient {
  readonly #getClient: ServiceClientFactory;

  /**
   * Creates an administrative client namespace.
   *
   * @param getClient - Internal lazy service-client factory shared with the root client.
   */
  constructor(getClient: ServiceClientFactory) {
    this.#getClient = getClient;
  }

  /** Administrative system and projection diagnostics. */
  get diagnostics(): Client<typeof AdminDiagnosticsService> { return this.#getClient(AdminDiagnosticsService); }

  /** Administrative durable event-log inspection. */
  get eventLog(): Client<typeof AdminEventLogService> { return this.#getClient(AdminEventLogService); }

  /** Administrative permission definitions and role grants. */
  get permissions(): Client<typeof AdminPermissionService> { return this.#getClient(AdminPermissionService); }

  /** Administrative role lifecycle operations. */
  get roles(): Client<typeof AdminRoleService> { return this.#getClient(AdminRoleService); }

  /** Administrative room-group and room layout operations. */
  get roomLayout(): Client<typeof AdminRoomLayoutService> { return this.#getClient(AdminRoomLayoutService); }

  /** Administrative server configuration operations. */
  get server(): Client<typeof AdminServerService> { return this.#getClient(AdminServerService); }

  /** Administrative user, membership, password, and role operations. */
  get users(): Client<typeof AdminUserService> { return this.#getClient(AdminUserService); }
}

/**
 * Provides lazy, typed access to the complete Chatto ConnectRPC API.
 *
 * The client accepts an opaque bearer token or uses browser cookie
 * authentication when no token is supplied. Service accessors are stable:
 * repeated access returns the same generated Connect client. RPC errors surface
 * directly as `ConnectError` values, without automatic retries.
 */
export class ChattoClient {
  readonly #transport: Transport;
  readonly #clients = new Map<DescService, Client<DescService>>();

  /** Options used to configure RPC and realtime clients. */
  readonly options: ChattoTransportOptions;

  /** Lazy namespace containing every administrative service client. */
  readonly admin: ChattoAdminClient;

  /**
   * Creates a Chatto API client.
   *
   * @param options - Server URL, authentication, and optional transport overrides.
   *
   * @example
   * ```ts
   * const chatto = new ChattoClient({
   *   baseUrl: "https://chat.example.com",
   *   token: async () => tokenStore.current(),
   * });
   * const server = await chatto.discovery.getServer({});
   * ```
   */
  constructor(options: ChattoTransportOptions) {
    this.options = options;
    this.#transport = createChattoTransport(options);
    this.admin = new ChattoAdminClient(<S extends DescService>(service: S) => this.#client(service));
  }

  #client<S extends DescService>(service: S): Client<S> {
    let client = this.#clients.get(service);
    if (!client) {
      client = createClient(service, this.#transport);
      this.#clients.set(service, client);
    }
    return client as Client<S>;
  }

  /** Unauthenticated server metadata and login discovery. */
  get discovery(): Client<typeof ServerDiscoveryService> { return this.#client(ServerDiscoveryService); }

  /** Public external-identity confirmation and linking flows. */
  get externalIdentityAuth(): Client<typeof ExternalIdentityAuthService> { return this.#client(ExternalIdentityAuthService); }

  /** Message attachment asset reads and deletion operations. */
  get assets(): Client<typeof AssetService> { return this.#client(AssetService); }

  /** Room-scoped asset upload lifecycle operations. */
  get assetUploads(): Client<typeof AssetUploadService> { return this.#client(AssetUploadService); }

  /** Message CRUD, reaction, and link-preview operations. */
  get messages(): Client<typeof MessageService> { return this.#client(MessageService); }

  /** Self-service operations for the authenticated account. */
  get account(): Client<typeof MyAccountService> { return this.#client(MyAccountService); }

  /** Notification preference reads and updates. */
  get notificationPreferences(): Client<typeof NotificationPreferencesService> { return this.#client(NotificationPreferencesService); }

  /** Notification listing, hydration, and dismissal. */
  get notifications(): Client<typeof NotificationService> { return this.#client(NotificationService); }

  /** Web-push subscription and notification operations. */
  get pushNotifications(): Client<typeof PushNotificationService> { return this.#client(PushNotificationService); }

  /** Public role metadata available to the authenticated caller. */
  get roles(): Client<typeof RoleService> { return this.#client(RoleService); }

  /** Visible room and room-group directory operations. */
  get roomDirectory(): Client<typeof RoomDirectoryService> { return this.#client(RoomDirectoryService); }

  /** Room lifecycle, timeline, membership, moderation, and typing operations. */
  get rooms(): Client<typeof RoomService> { return this.#client(RoomService); }

  /** Authenticated server state such as the message of the day. */
  get server(): Client<typeof ServerService> { return this.#client(ServerService); }

  /** Thread timeline, hydration, and follow-state operations. */
  get threads(): Client<typeof ThreadService> { return this.#client(ThreadService); }

  /** Server-wide visible user and member directory operations. */
  get users(): Client<typeof UserService> { return this.#client(UserService); }

  /** Profile and preference operations for the current viewer. */
  get viewer(): Client<typeof ViewerService> { return this.#client(ViewerService); }

  /** Room-scoped voice-call state and lifecycle operations. */
  get calls(): Client<typeof VoiceCallService> { return this.#client(VoiceCallService); }

  /**
   * Creates an independent realtime client sharing this client's URL and token.
   *
   * The returned client is not connected automatically. Each invocation returns
   * a new instance so callers can control its listener and connection lifecycle.
   *
   * @param options - Optional WebSocket factory and timer implementation.
   * @returns A disconnected realtime client.
   *
   * @example
   * ```ts
   * const realtime = chatto.realtime();
   * realtime.addEventListener("messagePosted", ({ detail }) => {
   *   console.log(detail.event.messageEventId);
   * });
   * await realtime.connect();
   * ```
   */
  realtime(options: Omit<RealtimeClientOptions, "baseUrl" | "token"> = {}): RealtimeClient {
    return new RealtimeClient({
      ...options,
      baseUrl: this.options.baseUrl,
      ...(this.options.token === undefined ? {} : { token: this.options.token }),
    });
  }
}
