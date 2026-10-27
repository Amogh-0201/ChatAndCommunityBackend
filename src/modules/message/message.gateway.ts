import { HttpException, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io';
import { MessageService } from './message.service';
import { JoinUserDto } from './dto/join-user.dto';
import { SendWsMessageDto } from './dto/send-ws-message.dto';


@WebSocketGateway({
    cors: {
        origin: '*',  // local development only
    },
})
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
export class MessageGateway {

    private readonly logger = new Logger(MessageGateway.name);

    @WebSocketServer()
    server: Server

    constructor(private readonly messageService: MessageService) {}

    // associate the socket with a test user
    @SubscribeMessage('user:join')
    async handleJoin(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: JoinUserDto
    ) {
        const previousUserId = client.data.userId as string | undefined;
        
        if(previousUserId) {
            await client.leave(`user:${previousUserId}`);
        }

        await client.join(`user:${data.userId}`);

        client.data.userId = data.userId;

        return {
            ok: true,
            userId: data.userId
        };
    }

    // save and deliver a message
    @SubscribeMessage('message:send')
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: SendWsMessageDto
    ) {
        const senderId = client.data.userId as string | undefined;
        if(!senderId) {
            return {
                ok: false,
                error: 'join a user room first'
            };
        }

        try {
            // Reuse existing REST business logic
            const message = await this.messageService.create({
                senderId,
                recipientId: data.recipientId,
                content: data.content
            });

            // Broadcast only after successful persistence
            this.server
                .to(`user:${senderId}`)
                .to(`user:${data.recipientId}`)
                .emit('message:new', message);

            // Acknowledgement for sender
            return {
                ok: true,
                message
            };

        } catch(error) {
            
            if(error instanceof HttpException) {
                return {
                    ok: false,
                    error: error.message
                };
            }

            this.logger.error(
                'Message sending failed',
                error instanceof Error ? error.stack : String(error),
            );

            return {
                ok: false,
                error: 'unable to send message'
            };
        }
    }
}