import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow local testing frontends (e.g. the discovery playground page) to call
  // the API cross-origin during development.
  app.enableCors({ origin: true, credentials: true });

  // Global validation pipe — enables class-validator decorators on DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global API prefix — all routes start with /api/v1
  app.setGlobalPrefix("api/v1");

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
