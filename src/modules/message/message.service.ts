import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ConversationService } from '../conversation/conversation.service';

interface SendConversationMessageInput {
    senderId: string;
    conversationId: string;
    content: string;
}

@Injectable()
export class MessageService {
    
    constructor(
        private readonly prisma: PrismaService,
        private readonly conversationService: ConversationService
    ) {}

    async sendToConversation(dto: SendConversationMessageInput) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                // Check that the sender is a member of this conversation.
                const membership = await tx.conversationMember.findUnique({
                    where: {
                        conversationId_userId: {
                            conversationId: dto.conversationId,
                            userId: dto.senderId
                        }
                    },
                    select: { userId: true }
                });

                if(!membership) throw new ForbiddenException('You are not a member of this conversation.');

                // Persist the message.
                const message = await tx.message.create({
                    data: {
                        senderId: dto.senderId,
                        conversationId: dto.conversationId,
                        content: dto.content
                    },
                    select: {
                        id: true,
                        senderId: true,
                        conversationId: true,
                        content: true,
                        createdAt: true
                    }
                });

                // Update conversation activity.
                await tx.conversation.update({
                    where: { id: dto.conversationId },
                    data: { updatedAt: new Date() }
                });

                //console.log(message);
                return message;
            });
        } catch(error) {
            if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new NotFoundException('Sender or conversation does not exist');
            }
            throw error;
        }
    }

    async getConversationMessages(
        conversationId: string,
        currentUserId: string,
        limit = 50,
        cursor?: string
    ) {
        if(!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new BadRequestException('Limit must be between 1 and 100');
        }

        // Only conversation members can read its messages.
        await this.conversationService.assertMember(conversationId, currentUserId);

        // A cursor must belong to the requested conversation.
        if(cursor) {
            const cursorMessage = await this.prisma.message.findFirst({
                where: {
                    id: cursor,
                    conversationId
                },
                select: { id: true }
            });

            if(!cursorMessage) throw new BadRequestException('Invalid message cursor');
        }

        const messages = await this.prisma.message.findMany({
            where: {
                conversationId 
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' }
            ],
            take: limit + 1,

            ...(cursor? {
                    cursor: { id: cursor },
                    skip: 1
                } : {}
            ),

            select: {
                id: true,
                senderId: true,
                conversationId: true,
                content: true,
                createdAt: true
            }
        });

        const hasMore = messages.length > limit;

        const page = messages.slice(0, limit);

        // The next cursor points to the oldest message in this page.
        const nextCursor = hasMore ? page[page.length - 1].id : null;

        // Return messages chronologically.
        return  {
            messages: page.reverse(),
            nextCursor,
            hasMore
        };
    }
}
