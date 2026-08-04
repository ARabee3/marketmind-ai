import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  Controller,
  Post,
  HttpCode,
  Body,
} from "@nestjs/common";
import * as request from "supertest";

/**
 * Routing verification for the inbound n8n callback (Issue #119 Blocker 2).
 *
 * The callback lives under `/internal/v1/publishing/dispatch/:attemptId/callback`
 * and MUST be excluded from the global `api/v1` prefix — otherwise n8n POSTs to
 * `/internal/v1/...` (as advertised by N8nClientService) would 404. We also
 * assert a PUBLIC controller is still prefixed with `api/v1` so the exclude
 * does not swallow normal owner routes.
 */
@Controller("publication-intents")
class StubPublicController {
  @Post()
  create(@Body() _b: unknown) {
    return { ok: true };
  }
}

@Controller()
class StubCallbackController {
  @Post("internal/v1/publishing/dispatch/:attemptId/callback")
  @HttpCode(200)
  handle(@Body() _b: unknown) {
    return { ok: true };
  }
}

describe("Publishing callback routing (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StubPublicController, StubCallbackController],
    }).compile();

    app = module.createNestApplication();
    // Mirror main.ts exactly.
    app.setGlobalPrefix("api/v1", { exclude: ["internal/*splat"] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("routes the callback at /internal/v1/... WITHOUT the api/v1 prefix", () => {
    return request(app.getHttpServer())
      .post("/internal/v1/publishing/dispatch/attempt-1/callback")
      .send({ attemptId: "attempt-1" })
      .expect(200)
      .expect((res) => expect(res.body.ok).toBe(true));
  });

  it("does NOT route the callback under the doubled /api/v1/internal/v1/... path", () => {
    return request(app.getHttpServer())
      .post("/api/v1/internal/v1/publishing/dispatch/attempt-1/callback")
      .send({ attemptId: "attempt-1" })
      .expect(404);
  });

  it("still applies /api/v1 prefix to public controllers", () => {
    return request(app.getHttpServer())
      .post("/api/v1/publication-intents")
      .send({})
      .expect(201)
      .expect((res) => expect(res.body.ok).toBe(true));
  });

  it("does NOT expose public controllers without the prefix", () => {
    return request(app.getHttpServer())
      .post("/publication-intents")
      .send({})
      .expect(404);
  });
});
