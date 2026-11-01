import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { CreateMessageInput } from './types/create-message-input';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class MessageService {
    
    constructor(private readonly prisma: PrismaService) {}

    private async getOrCreateDirectConversation(senderId: string, recipientId: string) {

        // Sorting ensures A:B and B:A produce the same key.
        const [userA, userB] = [senderId, recipientId].sort();
        const directKey = `direct:${userA}:${userB}`;

        return this.prisma.conversation.upsert({
            where: { directKey },
            update: {},
            create: {
                type: 'DIRECT',
                directKey,
                createdById: senderId,
                members: {
                    create: [
                        { userId: senderId, role: 'OWNER' },
                        { userId: recipientId, role: 'MEMBER' }
                    ]
                }
            },
            select: {
                id: true,
            }
        });
    }

    async create(dto: CreateMessageInput) {
        
        if (dto.senderId === dto.recipientId) {
            throw new BadRequestException(
                'You cannot send a message to yourself',
            );
        }

        try {
            const conversation = await this.getOrCreateDirectConversation(
                dto.senderId,
                dto.recipientId,
            );

            const message = await this.prisma.message.create({
                data: {
                    senderId: dto.senderId,
                    conversationId: conversation.id,
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

            // Keep recipientId in the response for backward compatibility.
            return {
                ...message,
                recipientId: dto.recipientId
            };

        } catch(error) {
            if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new NotFoundException('Sender or recipient does not exist');
            }
            throw error;
        }
    }

    async getConversation(currentUserId: string, otherUserId: string) {
        
        if(currentUserId === otherUserId) {
            throw new BadRequestException("Conversation requires two different users");
        }

        const [userA, userB] = [currentUserId, otherUserId].sort();

        const directKey = `direct:${userA}:${userB}`;

        const conversation = await this.prisma.conversation.findUnique({
            where: { directKey },
            select: {
                id: true
            }
        });

        // no messages means an empty array.
        if(!conversation) {
            return [];
        }

        const messages = await this.prisma.message.findMany({
            where: {
                conversationId: conversation.id
            },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' }
            ],
            take: 50, // limit to 50 messages => later pagination can be implemented
            select: {
                id: true,
                senderId: true,
                conversationId: true,
                content: true,
                createdAt: true
            }
        });

        return messages.reverse().map((message) => ({
            ...message,
            recipientId: message.senderId === currentUserId ? otherUserId : currentUserId
        }));
    }
}
