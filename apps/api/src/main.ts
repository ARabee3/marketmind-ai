import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global API prefix — all routes start with /api/v1
  app.setGlobalPrefix("api/v1");

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 MarketMind API running on http://localhost:${port}/api/v1`);
}

bootstrap();
