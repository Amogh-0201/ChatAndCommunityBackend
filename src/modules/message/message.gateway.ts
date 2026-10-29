import { HttpException, Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import {ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io';
import { MessageService } from './message.service';
import { JoinUserDto } from './dto/join-user.dto';
import { SendWsMessageDto } from './dto/send-ws-message.dto';
import { WsSessionGuard } from './guards/ws-session.guard';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../lib/database/prisma.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';
import { SocketAuthUser } from '../auth/types/socket-auth-user';


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

        // Only the server chooses which user room this socket joins.
        await client.join(`user:${authUser.id}`);

        this.socketSessionRegistry.register(authUser.sessionId, client);

        // Disconnect the socket when its access token expires.
        const remainingMs = authUser.expiresAt - Date.now();

        if(remainingMs <= 0) {
            client.disconnect(true);
            return;
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

        if(authUser) {
            this.socketSessionRegistry.unregister(authUser.sessionId, client);
        }
    }

    // save and deliver a message
    @SubscribeMessage('message:send')
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: SendWsMessageDto
    ) {
        const authUser = client.data.authUser as SocketAuthUser;

        try {
            // Never accept senderId from the client.
            const message = await this.messageService.create({
                senderId: authUser.id,
                recipientId: data.recipientId,
                content: data.content
            });

            // Deliver to all connected devices belonging to the recipient.
            this.server
                .to(`user:${data.recipientId}`)
                .emit('message:new', message);
            
            // Deliver to the sender's OTHER devices, excluding this socket.
            client
                .to(`user:${authUser.id}`)
                .emit('message:new', message);
            
            // The current sender receives this response via its ack callback.
            return {
                ok: true,
                message
            };

        } catch(error) {
            console.error('[WS] message:send failed:', error);
            if (error instanceof HttpException) {
                return {
                    ok: false,
                    error: error.message,
                };
            }

            this.logger.error(
                'Message sending failed',
                error instanceof Error ? error.stack : String(error),
            );

            return {
                ok: false,
                error: 'Unable to send message',
            };
        }
    }
}