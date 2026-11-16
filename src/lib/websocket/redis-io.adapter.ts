import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions, Server } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
    
    private readonly redisLogger = new Logger(RedisIoAdapter.name);

    private adapterConstructor!: ReturnType<typeof createAdapter>;

    private pubClient!: ReturnType<typeof createClient>;
    private subClient!: ReturnType<typeof createClient>;

    constructor(
        app: INestApplicationContext,
        private readonly configService: ConfigService
    ) {
        super(app);
    }

    async connectToRedis() {
        
        const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
        
        this.pubClient = createClient({ url: redisUrl });

        this.subClient = this.pubClient.duplicate();

        this.pubClient.on('error', (error) => {
            this.redisLogger.error('Redis publisher error', error);
        });

        this.subClient.on('error', (error) => {
            this.redisLogger.error('Redis subscriber error', error);
        });

        await Promise.all([
            this.pubClient.connect(),
            this.subClient.connect()
        ]);

        this.adapterConstructor = createAdapter(this.pubClient, this.subClient);

        this.redisLogger.log('Socket.IO Redis adapter connected');
    }

    createIOServer(port: number, options?: ServerOptions): Server {
        
        const server = super.createIOServer(port, options);

        server.adapter(this.adapterConstructor);
        
        return server;
    }

    async dispose(): Promise<void> {

        await super.dispose();
        
        await Promise.allSettled([
            this.pubClient?.quit(),
            this.subClient?.quit()
        ]);
    }

}