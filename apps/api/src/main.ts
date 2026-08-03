import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import * as cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Cookie parser — required to read HttpOnly refresh token cookies
  app.use(cookieParser());

  // CORS — restrict to the web origin and allow credentials (cookies)
  app.enableCors({
    origin: configService.get<string>("cors.origin"),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Global validation pipe — enables class-validator decorators on DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // One catch-all filter delegates expected HTTP exceptions to the stable
  // error-code mapper and hides internals for every unexpected exception.
  // Keeping the delegation inside one filter avoids Nest's reverse global
  // filter precedence turning ordinary 4xx responses into generic 500s.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global API prefix — all public routes start with /api/v1.
  // Internal routes (the inbound n8n callback lives under /internal/v1/...,
  // see PUBLISHING_AUTOMATION_ARCHITECTURE.md §11 and the URL advertised to n8n
  // in N8nClientService) are excluded so they keep their own /internal/ prefix
  // and are not reachable through the normal /api/v1 owner surface.
  //
  // NestJS `exclude` in this build (nestjs/core 11.x) accepts string paths
  // compiled by path-to-regexp v8; a named wildcard `*splat` is required to
  // match the full remaining path (a bare `internal` would only match the
  // exact `/internal` token, and RegExp entries are NOT supported here despite
  // older docs).
  app.setGlobalPrefix("api/v1", {
    exclude: ["internal/*splat"],
  });

  const port = configService.get<number>("port") || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
