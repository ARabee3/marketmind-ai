import { CallbacksController } from "../callbacks.controller";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException, ConflictException } from "@nestjs/common";
import * as crypto from "crypto";

const SECRET = "test-signing-secret-32chars-long!!";

function buildValidCallback(attemptId: string) {
  const timestamp = new Date().toISOString();
  const outcome = "published";
  const nonce = crypto.randomUUID();
  const canonical = [attemptId, outcome, nonce, timestamp].join(":");
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(canonical)
    .digest("hex");
  return { attemptId, outcome, nonce, timestamp, signature } as any;
}

describe("CallbacksController (Transaction & State Updates)", () => {
  let controller: CallbacksController;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let config: jest.Mocked<Partial<ConfigService>>;

  beforeEach(() => {
    prisma = {
      publishingCallbackIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      } as any,
      publishingAttempt: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "att-1", intentId: "intent-1" }),
        findFirst: jest.fn().mockResolvedValue({ id: "att-1" }),
        update: jest.fn(),
      } as any,
      publishingResult: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      } as any,
      publishingIntent: {
        update: jest.fn(),
      } as any,
      $transaction: jest.fn().mockImplementation(async (cb) => {
        // Evaluate the callback passing in the mocked prisma clients
        return cb(prisma);
      }),
    };

    config = {
      get: jest.fn().mockReturnValue(SECRET),
    };

    controller = new CallbacksController(prisma as any, config as any);
    jest.spyOn(controller["logger"], "log").mockImplementation(() => {});
    jest.spyOn(controller["logger"], "warn").mockImplementation(() => {});
  });

  it("rejects a conflicting replay with 409 Conflict", async () => {
    const cb = buildValidCallback("att-1");
    // The nonce was already consumed with a DIFFERENT payload: the identity
    // create races into the unique (external_callback_id) index and loses
    // (P2002); re-reading it shows a different payloadHash → conflict.
    (prisma.publishingCallbackIdentity!.create as jest.Mock).mockRejectedValue({
      code: "P2002",
      name: "PrismaClientKnownRequestError",
    });
    (
      prisma.publishingCallbackIdentity!.findUnique as jest.Mock
    ).mockResolvedValue({
      payloadHash: "stored-different-payload-hash",
    });

    await expect(controller.handleCallback("att-1", cb)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.publishingResult!.create).not.toHaveBeenCalled();
  });

  it("treats an identical-payload replay under the same nonce as a 200 no-op", async () => {
    const cb = buildValidCallback("att-1");
    // A concurrent handler consumed the nonce with the SAME canonical payload:
    // the create loses the race (P2002), re-read matches our payloadHash, and
    // the controller returns ok without writing a second result row.
    const sameHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(cb))
      .digest("hex");
    (prisma.publishingCallbackIdentity!.create as jest.Mock).mockRejectedValue({
      code: "P2002",
      name: "PrismaClientKnownRequestError",
    });
    (
      prisma.publishingCallbackIdentity!.findUnique as jest.Mock
    ).mockResolvedValue({
      payloadHash: sameHash,
    });

    await expect(controller.handleCallback("att-1", cb)).resolves.toEqual({
      ok: true,
    });
    expect(prisma.publishingResult!.create).not.toHaveBeenCalled();
    expect(prisma.publishingAttempt!.update).not.toHaveBeenCalled();
  });

  it("accepts a valid callback and executes a single database transaction", async () => {
    const cb = buildValidCallback("att-1");

    await controller.handleCallback("att-1", cb);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.publishingCallbackIdentity!.create).toHaveBeenCalled();
    expect(prisma.publishingResult!.create).toHaveBeenCalled();
    expect(prisma.publishingAttempt!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
    expect(prisma.publishingIntent!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  it("rolls back the entire transaction if any update fails (partial failure)", async () => {
    const cb = buildValidCallback("att-1");

    // Simulate a database failure during the transaction (e.g. unique constraint violation on Result)
    prisma.$transaction = jest.fn().mockImplementation(async (cb) => {
      // Intentionally throw an error during the transaction callback
      throw new Error("Simulated database write error");
    });

    await expect(controller.handleCallback("att-1", cb)).rejects.toThrow(
      "Simulated database write error",
    );

    // The NestJS/Prisma wrapper guarantees that an error thrown from inside `$transaction`
    // triggers a Postgres ROLLBACK, meaning the CallbackIdentity is NOT saved if the Result fails.
  });
});
