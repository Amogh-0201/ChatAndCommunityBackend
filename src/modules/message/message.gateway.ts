import { HttpException, Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import {ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io';
import { MessageService } from './message.service';
import { SendWsMessageDto } from './dto/send-ws-message.dto';
import { WsSessionGuard } from './guards/ws-session.guard';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../lib/database/prisma.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';
import { SocketAuthUser } from '../auth/types/socket-auth-user';
import { ConversationService } from '../conversation/conversation.service';
import { ConversationRoomDto } from './dto/conversation-room.dto';


type AccessTokenPayload = {
    sub: string;
    sid: string;
    exp: number;
};


@WebSocketGateway({
    cors: {
        origin: '*',  // local development only
    },
})
@UseGuards(WsSessionGuard)
@UsePipes(
    new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
            new WsException(
                errors.flatMap((error) => 
                    Object.values(error.constraints ?? {})
                ).join('; ') || 'Invalid Payload',
            ),
    }),
)
export class MessageGateway implements OnGatewayInit {

    private readonly logger = new Logger(MessageGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly messageService: MessageService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
        private readonly conversationService: ConversationService,
        private readonly socketSessionRegistry: SocketSessionRegistry
    ) {}

    afterInit(server: Server) {
        // Runs before a new Socket.IO connection is accepted.
        server.use((client, next) => {
            void this.authenticateSocket(client, next);
        });
    }

    private async authenticateSocket(client: Socket, next: (err?: Error) => void) {

        const token: unknown = client.handshake.auth?.token;
        if (typeof token !== 'string' || token.length === 0) {
            return next(new Error('Unauthorized'));
        }

        try {
            const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
                token,
                {
                    issuer: this.configService.getOrThrow<string>('JWT_ISSUER'),
                    audience: this.configService.getOrThrow<string>('JWT_AUDIENCE'),
                    algorithms: ['HS256']
                }
            );

            if(
                typeof payload.sub !== 'string' ||
                typeof payload.sid !== 'string' ||
                typeof payload.exp !== 'number'
            ) {
                return next(new Error("Unauthorized"));
            }

            const session = await this.prisma.authSession.findFirst({
                where: {
                    id: payload.sid,
                    userId: payload.sub,
                    revokedAt: null,
                    expiresAt: { gt: new Date() }
                },
                select: { id: true }
            });

            if(!session) {
                return next(new Error("Unauthorized"));
            }

            const authUser: SocketAuthUser = {
                id: payload.sub,
                sessionId: payload.sid,
                expiresAt: payload.exp * 1000
            }

            client.data.authUser = authUser;

            return next();
        } catch {
            // Do not expose JWT verification or database details.
            return next(new Error('Unauthorized'));
        }
    }

    async handleConnection(client: Socket) {

        const authUser = client.data.authUser as SocketAuthUser | undefined;

        // The handshake middleware should already have authenticated it.
        if(!authUser) {
            client.disconnect(true);
            return;
        }

        // Disconnect the socket when its access token expires.
        const remainingMs = authUser.expiresAt - Date.now();

        if(remainingMs <= 0) {
            client.disconnect(true);
            return;
        }

        // Only the server chooses which user room this socket joins.
        await client.join(`user:${authUser.id}`);

        const becameOnline = this.socketSessionRegistry.register(authUser.sessionId, authUser.id, client);
        if(becameOnline) {
            try {
                await this.broadcastPresence(authUser.id, 'presence:online');
            } catch(error) {
                this.logger.error('Failed to broadcast online presence', error);
            }
        }

        // Send the connecting socket the current presence of its peers.
        try {
            await this.sendPresenceSnapshot(client, authUser.id);
        } catch(error) {
            this.logger.error('Failed to send presence snapshot', error);
        }

        const expiryTimer = setTimeout(
            () => client.disconnect(true),
            remainingMs
        );

        expiryTimer.unref?.();
        client.data.authExpiryTimer = expiryTimer;
    }

    handleDisconnect(client: Socket) {

        const authUser = client.data.authUser as SocketAuthUser | undefined;
        const expiryTimer = client.data.authExpiryTimer as ReturnType<typeof setTimeout> | undefined;

        if(expiryTimer) {
            clearTimeout(expiryTimer);
        }

        if(!authUser) return;
        
        const becameOffline = this.socketSessionRegistry.unregister(authUser.sessionId, authUser.id, client);
        if(becameOffline) {
            void this.broadcastPresence(authUser.id, 'presence:offline')
                .catch(error => {
                    this.logger.error('Failed to broadcast offline presence', error);
                });
        }
        
    }

    @SubscribeMessage('conversation:join')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: ConversationRoomDto
    ) {
        const authUser = client.data.authUser as SocketAuthUser;

        try {
            await this.conversationService.assertMember(data.conversationId, authUser.id);
            await client.join(`conversation:${data.conversationId}`);

            // Send the online status of the other members in this conversation.
            const peers = await this.prisma.conversationMember.findMany({
                where: {
                    conversationId: data.conversationId,
                    userId: { not: authUser.id }
                },
                select: { userId: true }
            });

            const onlineUserIds = peers.map(peer => peer.userId)
                .filter(userId => this.socketSessionRegistry.isUserOnline(userId));

            client.emit('presence:snapshot', { onlineUserIds });

            return {
                ok: true,
                conversationId: data.conversationId
            };
        } catch(error) {
            if(error instanceof HttpException) {
                return {
                    ok: false,
                    error: error.message
                };
            }

            this.logger.error('Conversation join failed', error);

            return {
                ok: false,
                error: 'Unable to join conversation'
            };
        }
    }

    @SubscribeMessage('conversation:leave')
    async handleLeaveConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: ConversationRoomDto
    ) {
        await client.leave(`conversation:${data.conversationId}`);
        return {
            ok: true,
            conversationId: data.conversationId
        };
    }

    @SubscribeMessage('message:send')
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: SendWsMessageDto
    ) {
        const authUser = client.data.authUser as SocketAuthUser;

        try {
            // Persist the message after checking membership.
            const message = await this.messageService.sendToConversation({
                senderId: authUser.id,
                conversationId: data.conversationId,
                content: data.content
            });

            const members = await this.prisma.conversationMember.findMany({
                where: { conversationId: data.conversationId },
                select: { userId: true }
            });

            for(const member of members) {
                if(member.userId === authUser.id) {
                    // Notify the sender's other devices, but not this socket.
                    client.to(`user:${member.userId}`).emit('message:new', message);
                    continue;
                }

                // Notify every connected device belonging to this recipient.
                this.server.to(`user:${member.userId}`).emit('message:new', message);
            }

            return  {
                ok: true,
                message
            };
        } catch(error) {
            this.logger.error('[WS] message:send failed:', error);
            if(error instanceof HttpException) {
                return {
                    ok: false,
                    error: error.message
                };
            }
            return {
                ok: false,
                error: 'Unable to send message',
            };
        }
    }

    @SubscribeMessage('presence:get-snapshot')
    async handleGetPresenceSnapshot(
        @ConnectedSocket() client: Socket
    ) {
        const authUser = client.data.authUser as SocketAuthUser;
        
        await this.sendPresenceSnapshot(client, authUser.id);
        
        return { ok: true };
    }

    @SubscribeMessage('typing:start')
    async handleTypingStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: ConversationRoomDto
    ) {
        return this.handleTypingEvent(client, data, 'typing:started');
    }

    @SubscribeMessage('typing:stop')
    async handleTypingStop(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: ConversationRoomDto
    ) {
        return this.handleTypingEvent(client, data, 'typing:stopped');
    }

    private async handleTypingEvent(
        client: Socket,
        data: ConversationRoomDto,
        event: 'typing:started' | 'typing:stopped'
    ) {
        const authUser = client.data.authUser as SocketAuthUser;

        const room = `conversation:${data.conversationId}`;
        
        try {
            // Verify that the user is actually a member.
            await this.conversationService.assertMember(data.conversationId, authUser.id);

            // Require the socket to have joined this conversation.
            if(!client.rooms.has(room)) {
                return {
                    ok: false,
                    error: 'Join the conversation before sending typing events'
                };
            }

            // Send to everyone in the room except this socket.
            client.to(room).emit(event, {
                conversationId: data.conversationId,
                userId: authUser.id
            });

            return { ok: true };
        } catch(error) {
            if(error instanceof HttpException) {
                return {
                    ok: false,
                    error: error.message
                };
            }

            this.logger.error('Typing event failed', error);

            return {
                ok: false,
                error: 'Unable to process typing event'
            };
        }
    }

    private async getConversationPeerIds(userId: string): Promise<string[]> {
        
        // Find all conversations this user belongs to.
        const memberships = await this.prisma.conversationMember.findMany({
            where: { userId },
            select: { conversationId: true }
        });

        const conversationIds = memberships.map(membership => membership.conversationId);

        if (conversationIds.length === 0) return [];

        // Find other members of those conversations.
        const peers = await this.prisma.conversationMember.findMany({
            where: {
                conversationId: { in: conversationIds },
                userId: { not: userId }
            },
            select: { userId: true }
        });

        // A peer may share multiple conversations, so remove duplicates.
        return [...new Set(peers.map(peer => peer.userId))];
    }

    private async broadcastPresence(
        userId: string,
        event: 'presence:online' | 'presence:offline'
    ) {
        const peerIds = await this.getConversationPeerIds(userId);

        for(const peerId of peerIds) {
            this.server.to(`user:${peerId}`).emit(event, { userId });
        }
    }

    private async sendPresenceSnapshot(client: Socket, userId: string) {
        
        const peerIds = await this.getConversationPeerIds(userId);
        
        const onlineUserIds = peerIds.filter(
            peerId => this.socketSessionRegistry.isUserOnline(peerId)
        );

        client.emit('presence:snapshot', { onlineUserIds });
    }
}