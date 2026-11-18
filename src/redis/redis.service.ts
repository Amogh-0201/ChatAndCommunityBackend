import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, RedisClientType } from "redis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {

    private readonly client: RedisClientType;

    constructor(private readonly configService: ConfigService) {
        this.client = createClient({
            url: this.configService.getOrThrow<string>('REDIS_URL')
        });
        this.client.on('error', (error) => {
            console.error('Redis Client Error:', error);
        });
    }

    async onModuleInit() {
        await this.client.connect();
    }

    async onModuleDestroy() {
        if(this.client.isOpen) {
            await this.client.quit();
        }
    }

    getClient(): RedisClientType {
        return this.client;
    }
}