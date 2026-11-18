import { Injectable } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { RedisService } from "../../redis/redis.service";

@Injectable()
export class SocketSessionRegistry {

    private readonly redis: ReturnType<RedisService['getClient']>;
    
    private server?: Server;

    private readonly onlineUsersKey = 'presence:online-users';

    constructor(private readonly redisService: RedisService) {
        this.redis = this.redisService.getClient();
    }

    // The gateway provides its Socket.IO server instance.
    setServer(server: Server) {
        this.server = server;
    }

    private userSocketsKey(userId: string) {
        return `presence:user:${userId}:sockets`;
    }

    private sessionSocketsKey(sessionId: string) {
        return `presence:session:${sessionId}:sockets`
    }

    private socketMetadataKey(socketId: string) {
        return `presence:socket:${socketId}`;
    }

    async register(sessionId: string, userId: string, socket: Socket): Promise<boolean> {
        
        const userKey = this.userSocketsKey(userId);
        const sessionKey = this.sessionSocketsKey(sessionId);
        const metadataKey = this.socketMetadataKey(socket.id);

        // Add the socket to the user's socket Set.
        const added = await this.redis.sAdd(userKey, socket.id);

        // Add the socket to the session's socket Set.
        await this.redis.sAdd(sessionKey, socket.id);

        // Store information about this socket.
        await this.redis.hSet(metadataKey, {
            userId,
            sessionId,
            serverId: process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? 'local',
            connectedAt: Date.now().toString()
        });

        // Count the user's active sockets.
        const socketCount = await this.redis.sCard(userKey);

        // Keep the global online-users Set updated.
        if(socketCount > 0) {
            await this.redis.sAdd(this.onlineUsersKey, userId);
        }

        // Only a newly added socket that is the user's first connection reports an offline -> online transition.
        return added === 1 && socketCount === 1;
    }

    async unregister(sessionId: string, userId: string, socket: Socket): Promise<boolean> {
        
        const userKey = this.userSocketsKey(userId);
        const sessionKey = this.sessionSocketsKey(sessionId);
        const metadataKey = this.socketMetadataKey(socket.id);

        // Remove socket from the session Set.
        await this.redis.sRem(sessionKey, socket.id);

        // Remove socket from the user Set.
        const removed = await this.redis.sRem(userKey, socket.id);

        // Remove socket metadata.
        await this.redis.del(metadataKey);

        // Remove empty session Sets.
        const sessionCount = await this.redis.sCard(sessionKey);
        if (sessionCount === 0) {
            await this.redis.del(sessionKey);
        }

        // If the socket wasn't registered, it cannot cause a new online -> offline transition.
        if (removed === 0) {
            return false;
        }

        // Check whether the user has other active connections.
        const userSocketsCount = await this.redis.sCard(userKey);

        if(userSocketsCount === 0) {
            await this.redis.del(userKey);
            await this.redis.sRem(this.onlineUsersKey, userId);
            // User transitioned from online -> offline.
            return true;
        }

        return false;
    }

    async isUserOnline(userId: string): Promise<boolean> {

        return Boolean(await this.redis.sIsMember(this.onlineUsersKey, userId));
    }

    async getOnlineUserIds(): Promise<string[]> {

        return await this.redis.sMembers(this.onlineUsersKey);
    }

    async disconnectSession(sessionId: string): Promise<void> {
        
        if (!this.server) {
            throw new Error('Socket.IO server has not been initialized');
        }

        const sessionKey = this.sessionSocketsKey(sessionId);

        // Get socket IDs belonging to this session.
        const socketIds = await this.redis.sMembers(sessionKey);
        
        // Disconnect each socket through its private Socket.IO room.
        for(const socketId of socketIds) {
            this.server.in(socketId).disconnectSockets(true);
        }
    }

    async disconnectSessions(sessionIds: string[]): Promise<void> {
        
        for(const sessionId of sessionIds) {
            await this.disconnectSession(sessionId);
        }
    }
}