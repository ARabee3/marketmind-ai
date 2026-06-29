import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryRepository } from "./discovery.repository";

describe("DiscoveryProgressGateway", () => {
  const jwtService = {
    verifyAsync: jest.fn(),
  } as unknown as jest.Mocked<JwtService>;
  const configService = {
    getOrThrow: jest.fn(),
  } as unknown as jest.Mocked<ConfigService>;
  const repository = {
    findSessionForOwner: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryRepository>;

  let gateway: DiscoveryProgressGateway;

  beforeEach(() => {
    jest.resetAllMocks();
    configService.getOrThrow.mockReturnValue("access-secret");
    gateway = new DiscoveryProgressGateway(
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

  it("joins owner sessions and emits persisted progress snapshot", async () => {
    const client = socket("access-token");
    jwtService.verifyAsync.mockResolvedValue({
      sub: "owner-id",
      email: "owner@example.com",
      roles: [],
    });
    repository.findSessionForOwner.mockResolvedValue({
      progressEvents: [
        {
          seq: 1,
          stage: "session",
          status: "completed",
          messageKey: "discovery.session.accepted",
          messageText: "Discovery request accepted.",
          payload: {},
          createdAt: new Date("2026-06-29T10:00:00.000Z"),
        },
      ],
    } as never);

    await gateway.handleConnection(client);
    await gateway.joinDiscovery(client, {
      session_id: "11111111-1111-4111-8111-111111111111",
    });

    expect(repository.findSessionForOwner).toHaveBeenCalledWith(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(client.join).toHaveBeenCalledWith(
      "discovery:11111111-1111-4111-8111-111111111111",
    );
    expect(client.emit).toHaveBeenCalledWith("discovery.progress.snapshot", [
      expect.objectContaining({
        stage: "session",
        status: "completed",
      }),
    ]);
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
  } as unknown as Socket;
}
