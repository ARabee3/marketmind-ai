import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for the local Next.js frontend during development.
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  // Global validation pipe — enables class-validator decorators on DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter — returns stable error codes for the frontend.
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global API prefix — all routes start with /api/v1
  app.setGlobalPrefix("api/v1");

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
