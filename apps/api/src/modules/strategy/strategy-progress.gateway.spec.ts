import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { StrategyProgressGateway } from "./strategy-progress.gateway";
import { StrategyRepository } from "./strategy.repository";

describe("StrategyProgressGateway", () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as jest.Mocked<JwtService>;
  const configService = {
    getOrThrow: jest.fn(),
  } as unknown as jest.Mocked<ConfigService>;
  const repository = {
    getStrategyByIdAndOwner: jest.fn(),
    listProgressEvents: jest.fn(),
  } as unknown as jest.Mocked<StrategyRepository>;

  let gateway: StrategyProgressGateway;

  beforeEach(() => {
    jest.resetAllMocks();
    configService.getOrThrow.mockReturnValue("access-secret");
    gateway = new StrategyProgressGateway(
      jwtService,
      configService,
      repository,
    );
  });

  it("disconnects clients without an access token", async () => {
    const client = socket();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("joins owner strategies and emits a persisted progress snapshot", async () => {
    const client = socket("access-token");
    jwtService.verifyAsync.mockResolvedValue({
      sub: "owner-id",
      email: "owner@example.com",
      roles: [],
    });
    repository.getStrategyByIdAndOwner.mockResolvedValue({
      id: "strategy-id",
    } as never);
    repository.listProgressEvents.mockResolvedValue([
      {
        id: 1n,
        strategyId: "strategy-id",
        seq: 1,
        stage: "retrieval",
        status: "complete",
        messageKey: "strategy.retrieval.complete",
        messageText: "Knowledge retrieval complete.",
        payload: { retrieval_run_id: "run-1" },
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
      },
    ] as never);

    await gateway.handleConnection(client);
    await gateway.joinStrategy(client, {
      strategy_id: "strategy-id",
    });

    expect(repository.getStrategyByIdAndOwner).toHaveBeenCalledWith(
      "strategy-id",
      "owner-id",
    );
    expect(repository.listProgressEvents).toHaveBeenCalledWith("strategy-id");
    expect(client.join).toHaveBeenCalledWith("strategy:strategy-id");
    expect(client.emit).toHaveBeenCalledWith("strategy.progress.snapshot", [
      expect.objectContaining({
        type: "strategy_progress",
        strategy_id: "strategy-id",
        seq: 1,
        stage: "retrieval",
        status: "complete",
      }),
    ]);
  });

  it("does not join a strategy owned by another user", async () => {
    const client = socket("access-token");
    jwtService.verifyAsync.mockResolvedValue({ sub: "owner-id" });
    repository.getStrategyByIdAndOwner.mockResolvedValue(null);

    await gateway.handleConnection(client);
    await gateway.joinStrategy(client, { strategy_id: "strategy-id" });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith("strategy.error", {
      code: "STRATEGY_NOT_AVAILABLE",
    });
  });

  it("leaves the strategy room", async () => {
    const client = socket("access-token");

    await gateway.leaveStrategy(client, { strategy_id: "strategy-id" });

    expect(client.leave).toHaveBeenCalledWith("strategy:strategy-id");
  });

  it("emits mapped live progress events to the strategy room", () => {
    const emit = jest.fn();
    (gateway as unknown as { server: { to: jest.Mock } }).server = {
      to: jest.fn().mockReturnValue({ emit }),
    };

    gateway.emitProgress("strategy-id", {
      id: 1n,
      strategyId: "strategy-id",
      seq: 2,
      stage: "generating",
      status: "started",
      messageKey: "strategy.generating.started",
      messageText: "Strategy generation started.",
      payload: {},
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
    });

    expect(emit).toHaveBeenCalledWith(
      "strategy.progress",
      expect.objectContaining({
        type: "strategy_progress",
        strategy_id: "strategy-id",
        seq: 2,
      }),
    );
  });
});

function socket(token?: string): Socket {
  return {
    data: {},
    handshake: {
      auth: token ? { token } : {},
      headers: {},
    },
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn().mockResolvedValue(undefined),
  } as unknown as Socket;
}
