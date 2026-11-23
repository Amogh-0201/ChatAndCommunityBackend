import { Injectable } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { RedisService } from "../../redis/redis.service";
import { CLEANUP_EXPIRED_SOCKETS_SCRIPT, REGISTER_SOCKET_SCRIPT, RENEW_SOCKET_LEASE_SCRIPT, UNREGISTER_SOCKET_SCRIPT } from "./socket-presence.scripts";

export const PRESENCE_LEASE_DURATION_MS = 60_000;

@Injectable()
export class SocketSessionRegistry {

    private readonly redis: ReturnType<RedisService['getClient']>;
    
    private server?: Server;

    private readonly onlineUsersKey = 'presence:online-users';
    private readonly socketLeasesKey = 'presence:socket-leases';

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

        const now = Date.now();
        
        const result = await this.redis.eval(
            REGISTER_SOCKET_SCRIPT,
            {
                keys: [
                    this.userSocketsKey(userId),
                    this.sessionSocketsKey(sessionId),
                    this.socketMetadataKey(socket.id),
                    this.onlineUsersKey,
                    this.socketLeasesKey
                ],
                arguments: [
                    socket.id,
                    userId,
                    sessionId,
                    process.env.INSTANCE_ID ??
                        process.env.HOSTNAME ??
                        'local',
                    now.toString(),
                    (now + PRESENCE_LEASE_DURATION_MS).toString()
                ]
            }
        );

        return Number(result) === 1;
    }

    async unregister(sessionId: string, userId: string, socket: Socket): Promise<boolean> {
        
        const result = await this.redis.eval(
            UNREGISTER_SOCKET_SCRIPT,
            {
                keys: [
                    this.userSocketsKey(userId),
                    this.sessionSocketsKey(sessionId),
                    this.socketMetadataKey(socket.id),
                    this.onlineUsersKey,
                    this.socketLeasesKey
                ],
                arguments: [
                    socket.id,
                    userId,
                    sessionId
                ]
            }
        );

        return Number(result) === 1;
    }

    async renewLease(socketId: string): Promise<boolean> {

        const now = Date.now();

        const result = await this.redis.eval(
            RENEW_SOCKET_LEASE_SCRIPT,
            {
                keys: [
                    this.socketMetadataKey(socketId),
                    this.socketLeasesKey
                ],
                arguments: [
                    socketId,
                    now.toString(),
                    (now + PRESENCE_LEASE_DURATION_MS).toString()
                ]
            }
        );

        return Number(result) === 1;
    }

    async cleanupExpiredSockets(): Promise<string[]> {
        
        const result = await this.redis.eval(
            CLEANUP_EXPIRED_SOCKETS_SCRIPT,
            {
                keys: [
                    this.socketLeasesKey,
                    this.onlineUsersKey
                ],
                arguments: [
                    Date.now().toString(),
                    '500',
                    'presence:user:',
                    'presence:session:',
                    'presence:socket:'
                ]
            }
        );

        if(!Array.isArray(result)) {
            return [];
        }

        return result.map(String);
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