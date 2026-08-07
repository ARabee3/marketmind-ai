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
import type { StrategyProgressEvent } from "@marketmind/contracts";
import { JwtPayload } from "../auth/interfaces/jwt-payload.interface";
import {
  strategyProgressEventFromPersistence,
  strategyProgressEventsFromPersistence,
} from "./strategy-progress.mapper";
import type { PersistedStrategyProgressEvent } from "./strategy.repository";
import { StrategyRepository } from "./strategy.repository";

type StrategyRoomPayload = {
  readonly strategy_id: string;
};

function strategyCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Allow all origins in development mode for local web/test clients.
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
  namespace: "/ws/v1/strategy",
  cors: { origin: strategyCorsOrigin, credentials: true },
})
export class StrategyProgressGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server?: Server;

  private readonly logger = new Logger(StrategyProgressGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly strategyRepository: StrategyRepository,
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
        error instanceof Error
          ? error.message
          : "Invalid strategy socket token.",
      );
      client.disconnect(true);
    }
  }

  @SubscribeMessage("strategy.join")
  async joinStrategy(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const userId = client.data.userId;
    if (typeof userId !== "string" || !isStrategyRoomPayload(payload)) {
      client.emit("strategy.error", { code: "INVALID_JOIN_PAYLOAD" });
      return;
    }

    let joinedRoom: string | undefined;
    try {
      const strategy = await this.strategyRepository.getStrategyByIdAndOwner(
        payload.strategy_id,
        userId,
      );
      if (!strategy) {
        client.emit("strategy.error", {
          code: "STRATEGY_NOT_AVAILABLE",
        });
        return;
      }

      const room = progressRoom(payload.strategy_id);
      // Join before reading the snapshot so an event appended during the
      // database read is delivered live and then deduplicated by the client.
      await client.join(room);
      joinedRoom = room;
      const events = await this.strategyRepository.listProgressEvents(
        payload.strategy_id,
      );
      client.emit(
        "strategy.progress.snapshot",
        strategyProgressEventsFromPersistence(events),
      );
    } catch (error) {
      if (joinedRoom) {
        try {
          await client.leave(joinedRoom);
        } catch {
          // The client is already being disconnected; no cleanup is needed.
        }
      }
      this.logger.warn(
        error instanceof Error
          ? error.message
          : "Strategy progress snapshot could not be loaded.",
      );
      client.emit("strategy.error", {
        code: "STRATEGY_NOT_AVAILABLE",
      });
    }
  }

  @SubscribeMessage("strategy.leave")
  async leaveStrategy(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    if (!isStrategyRoomPayload(payload)) {
      client.emit("strategy.error", { code: "INVALID_LEAVE_PAYLOAD" });
      return;
    }

    await client.leave(progressRoom(payload.strategy_id));
  }

  emitProgress(
    strategyId: string,
    event: PersistedStrategyProgressEvent | StrategyProgressEvent,
  ): void {
    const progressEvent =
      "type" in event ? event : strategyProgressEventFromPersistence(event);
    this.server
      ?.to(progressRoom(strategyId))
      .emit("strategy.progress", progressEvent);
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

function isStrategyRoomPayload(value: unknown): value is StrategyRoomPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as { readonly strategy_id?: unknown };
  return (
    typeof payload.strategy_id === "string" && payload.strategy_id.length > 0
  );
}

function progressRoom(strategyId: string): string {
  return `strategy:${strategyId}`;
}
