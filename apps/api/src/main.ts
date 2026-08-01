import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import * as cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
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

  // Global exception filters — return stable error codes for the frontend.
  // HttpExceptionFilter must come first so it keeps mapping HTTP exceptions;
  // AllExceptionsFilter catches anything else (Prisma, unexpected runtime
  // errors) and returns a stable, friendly 500 instead of raw internals.
  app.useGlobalFilters(new HttpExceptionFilter(), new AllExceptionsFilter());

  // Global API prefix — all routes start with /api/v1
  app.setGlobalPrefix("api/v1");

  const port = configService.get<number>("port") || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
