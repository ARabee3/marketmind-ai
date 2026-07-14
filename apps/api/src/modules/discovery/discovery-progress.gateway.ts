import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtPayload } from "../auth/interfaces/jwt-payload.interface";
import { DiscoveryProgressEvent } from "./discovery-state";
import { progressEventsFromPersistence } from "./discovery-progress.mapper";
import { DiscoveryRepository } from "./discovery.repository";

type JoinDiscoveryPayload = {
  readonly session_id: string;
};

function discoveryCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Allow all origins in development mode for testing (tester, web, etc.)
  if (process.env.NODE_ENV === "development") {
    return callback(null, true);
  }
  const allowedOrigin = process.env.WEB_ORIGIN;
  if (!allowedOrigin) {
    return callback(new Error("WEB_ORIGIN is not configured"));
  }
  if (!origin || origin === allowedOrigin) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed`), false);
}

@WebSocketGateway({
  namespace: "/ws/v1/discovery",
  cors: { origin: discoveryCorsOrigin, credentials: true },
})
export class DiscoveryProgressGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server?: Server;

  private readonly logger = new Logger(DiscoveryProgressGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly discoveryRepository: DiscoveryRepository,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = authToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
      });
      client.data.userId = payload.sub;
    } catch (error) {
      this.logger.warn(
        error instanceof Error ? error.message : "Invalid discovery socket token.",
      );
      client.disconnect(true);
    }
  }

  @SubscribeMessage("discovery.join")
  async joinDiscovery(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const userId = client.data.userId;
    if (typeof userId !== "string" || !isJoinPayload(payload)) {
      client.emit("discovery.error", { code: "INVALID_JOIN_PAYLOAD" });
      return;
    }

    try {
      const session = await this.discoveryRepository.findSessionForOwner(
        userId,
        payload.session_id,
      );
      await client.join(progressRoom(payload.session_id));
      client.emit(
        "discovery.progress.snapshot",
        progressEventsFromPersistence(session.progressEvents),
      );
    } catch (error) {
      client.emit("discovery.error", {
        code: "DISCOVERY_SESSION_NOT_AVAILABLE",
      });
    }
  }

  emitProgress(sessionId: string, event: DiscoveryProgressEvent): void {
    this.server?.to(progressRoom(sessionId)).emit("discovery.progress", event);
  }
}

function authToken(client: Socket): string | undefined {
  const token = client.handshake.auth["token"];
  if (typeof token === "string" && token.trim()) {
    return token.trim();
  }

  const header = client.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return undefined;
}

function isJoinPayload(value: unknown): value is JoinDiscoveryPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as { readonly session_id?: unknown };
  return typeof payload.session_id === "string" && payload.session_id.length > 0;
}

function progressRoom(sessionId: string): string {
  return `discovery:${sessionId}`;
}
