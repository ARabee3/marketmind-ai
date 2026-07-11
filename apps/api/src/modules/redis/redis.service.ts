import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>("redis.url") || "redis://localhost:6379";
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
    this.client = null;
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error("Redis client is not connected");
    }
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.getClient().ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
}
