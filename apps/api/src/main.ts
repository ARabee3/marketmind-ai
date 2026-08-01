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

  // Global API prefix — all routes start with /api/v1
  app.setGlobalPrefix("api/v1");

  const port = configService.get<number>("port") || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
