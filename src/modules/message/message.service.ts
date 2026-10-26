import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class MessageService {
    
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateMessageDto) {
        
        if (dto.senderId === dto.recipientId) {
            throw new BadRequestException(
                'You cannot send a message to yourself',
            );
        }

        try {
            return await this.prisma.message.create({
                data: {
                    senderId: dto.senderId,
                    recipientId: dto.recipientId,
                    content: dto.content
                },
                select: {
                    id: true,
                    senderId: true,
                    recipientId: true,
                    content: true,
                    createdAt: true
                }
            });
        } catch(error) {
            if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new NotFoundException('Sender or recipient does not exist');
            }
            throw error;
        }
    }

    async getConversation(userA: string, userB: string) {
        
        if(userA === userB) {
            throw new BadRequestException("Conversation requires two different users");
        }

        const messages = await this.prisma.message.findMany({
            where: {
                OR: [
                    {senderId: userA, recipientId: userB},
                    {senderId: userB, recipientId: userA}
                ]
            },
            orderBy: [
                {createdAt: 'desc'},
                {id: 'desc'}
            ],
            take: 50,
            select: {
                id: true,
                senderId: true,
                recipientId: true,
                content: true,
                createdAt: true,
            }
        });

        return messages.reverse();
    }
}
