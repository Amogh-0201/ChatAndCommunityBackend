import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { ConversationType, ConversationRole, GroupJoinPolicy, Prisma, JoinRequestStatus } from '../../generated/prisma/client';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ReviewJoinRequestDto } from './dto/review-join-request.dto';

@Injectable()
export class ConversationService {

    constructor(private readonly prisma: PrismaService) {}

    // Shared authorization helpers
    async assertMember(conversationId: string, userId: string) {

        const membership = await this.prisma.conversationMember.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId
                }
            },
            select: {
                conversationId: true,
                userId: true,
                role: true
            }
        });

        if(!membership) {
            throw new ForbiddenException('You are not a member of this conversation');
        }

        return membership;
    }

    private async getGroupOrThrow(conversationId: string) {

        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId }
        });

        if(!conversation) {
            throw new NotFoundException('Conversation not found');
        }

        if(conversation.type !== ConversationType.GROUP) {
            throw new BadRequestException('This operation is only available for group conversations');
        }

        return conversation;
    }

    private async assertOwner(conversationId: string, userId: string) {

        const membership = await this.assertMember(conversationId, userId);

        if(membership.role !== ConversationRole.OWNER) {
            throw new ForbiddenException('Only the group owner can perform this operation');
        }

        return membership;
    }


    // Create group
    async createGroup(userId: string, dto: CreateGroupDto) {
        
        const joinPolicy = dto.joinPolicy ?? GroupJoinPolicy.REQUEST;

        return this.prisma.conversation.create({
            data: {
                type: ConversationType.GROUP,
                name: dto.name,
                joinPolicy: joinPolicy,
                createdById: userId,
                members: {
                    create: {
                        userId: userId,
                        role: ConversationRole.OWNER
                    }
                }
            },
            select: {
                id: true,
                type: true,
                name: true,
                joinPolicy: true,
                createdById: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        role: true,
                        joinedAt: true,
                    }
                }
            }
        });
    }

    // List current user's conversations
    async getMyConversations(userId: string) {
        return this.prisma.conversation.findMany({
            where: {
                members: {
                    some: { userId }
                }
            },
            orderBy: {
                updatedAt: 'desc'
            },
            select: {
                id: true,
                type: true,
                name: true,
                joinPolicy: true,
                createdById: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        role: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        members: true
                    }
                },
                messages: {
                    take: 1,
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' }
                    ],
                    select: {
                        id: true,
                        content: true,
                        senderId: true,
                        createdAt: true
                    }
                }
            }
        });
    }

    // Get conversation details
    async getConversationDetails(conversationId: string, userId: string) {

        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
            select: {
                id: true,
                type: true,
                name: true,
                joinPolicy: true,
                createdById: true,
                createdAt: true,
                updatedAt: true,
                members: {
                    select: {
                        userId: true,
                        role: true,
                        joinedAt: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        members: true
                    }
                }
            }
        });

        if(!conversation) {
            throw new NotFoundException('Conversation not found');
        }

        // Direct conversations are private. Group metadata can be viewed by authenticated users, including users who may want to join.
        if(conversation.type === ConversationType.DIRECT) {
            await this.assertMember(conversationId, userId);
        }

        return conversation;
    }

    // update group
    async updateGroup(conversationId: string, userId: string, dto: UpdateConversationDto) {

        await this.getGroupOrThrow(conversationId);
        await this.assertOwner(conversationId, userId);

        if (dto.name === undefined && dto.joinPolicy === undefined) {
            throw new BadRequestException('Provide at least one field to update');
        }

        return this.prisma.conversation.update({
            where: { id: conversationId },
            data: {
                ...(dto.name !== undefined && { name: dto.name }),
                ...(dto.joinPolicy !== undefined && { joinPolicy: dto.joinPolicy })
            },
            select: {
                id: true,
                name: true,
                joinPolicy: true,
                updatedAt: true
            }
        });
    }

    // Join group / request access
    async joinGroup(conversationId: string, userId: string) {

        const conversation = await this.getGroupOrThrow(conversationId);

        const existingMembership = await this.prisma.conversationMember.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId
                }
            }
        });

        if(existingMembership) {
            throw new ConflictException('You are already a member of this group');
        }

        // OPEN: add the user immediately.
        if(conversation.joinPolicy === GroupJoinPolicy.OPEN) {
            try {
                return await this.prisma.conversationMember.create({
                    data: {
                        conversationId,
                        userId,
                        role: ConversationRole.MEMBER
                    },
                    select: {
                        conversationId: true,
                        userId: true,
                        role: true,
                        joinedAt: true
                    }
                });
            } catch(error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002'
                ) {
                    throw new ConflictException('You are already a member of this group');
                }
                throw error;
            }
        }

        // REQUEST: create a pending request, or reopen a previously rejected/cancelled request.
        return this.prisma.$transaction(async (tx) => {
            const existingRequest = await tx.conversationJoinRequest.findUnique({
                where: {
                    conversationId_requesterId: {
                        conversationId,
                        requesterId: userId
                    }
                }
            });
            if(existingRequest?.status === 'PENDING') {
                throw new ConflictException('You already have a pending join request for this group');
            }
            if(existingRequest?.status === 'APPROVED') {
                throw new ConflictException('Your join request has already been approved');
            }

            if(existingRequest) {
                return tx.conversationJoinRequest.update({
                    where: { id: existingRequest.id },
                    data: {
                        status: 'PENDING',
                        reviewedAt: null,
                        reviewedById: null
                    },
                    select: {
                        id: true,
                        conversationId: true,
                        requesterId: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true
                    }
                });
            }

            return tx.conversationJoinRequest.create({
                data: {
                    conversationId,
                    requesterId: userId,
                },
                select: {
                    id: true,
                    conversationId: true,
                    requesterId: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true
                }
            });
        });
    }

    // Leave group
    async leaveGroup(conversationId: string, userId: string) {

        await this.getGroupOrThrow(conversationId);

        const membership = await this.assertMember(conversationId, userId);

        if(membership.role === ConversationRole.OWNER) {
            throw new ForbiddenException('The group owner cannot leave the group. Transfer ownership or delete the group instead.');
        }

        await this.prisma.conversationMember.delete({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId
                }
            }
        });

        return {
            message: 'You have successfully left the group'
        };
    }

    // List pending join requests for a group (owner only)
    async getJoinRequests(conversationId: string, userId: string) {

        await this.getGroupOrThrow(conversationId);
        await this.assertOwner(conversationId, userId);

        return this.prisma.conversationJoinRequest.findMany({
            where: {
                conversationId,
                status: JoinRequestStatus.PENDING
            },
            orderBy: {
                createdAt: 'asc'
            },
            select: {
                id: true,
                requesterId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                requester: {
                    select: {
                        id: true,
                        name: true,
                        username: true
                    }
                }
            }
        });
    }

    // Approve / reject join request (Owner only)
    async reviewJoinRequest(
        conversationId: string,
        requestId: string,
        userId: string,
        dto: ReviewJoinRequestDto
    ) {

        await this.getGroupOrThrow(conversationId);
        await this.assertOwner(conversationId, userId);

        return this.prisma.$transaction(async (tx) => {
            const request = await tx.conversationJoinRequest.findUnique({
                where: {
                    id: requestId,
                    conversationId: conversationId
                }
            });
            if(!request) {
                throw new NotFoundException('Join request not found');
            }

            if(request.status !== JoinRequestStatus.PENDING) {
                throw new ConflictException('This join request has already been reviewed');
            }

            const approved = dto.action === 'APPROVE';

            if(approved) {
                await tx.conversationMember.create({
                    data: {
                        conversationId,
                        userId: request.requesterId,
                        role: ConversationRole.MEMBER
                    }
                });
            }

            return tx.conversationJoinRequest.update({
                where: { id: requestId },
                data: {
                    status: approved ? JoinRequestStatus.APPROVED : JoinRequestStatus.REJECTED,
                    reviewedAt: new Date(),
                    reviewedById: userId
                },
                select: {
                    id: true,
                    conversationId: true,
                    requesterId: true,
                    status: true,
                    reviewedAt: true,
                    reviewedById: true
                }
            });
        });
    }

    // Cancel own pending join request
    async cancelJoinRequest(conversationId: string, userId: string) {

        await this.getGroupOrThrow(conversationId);

        const request = await this.prisma.conversationJoinRequest.findUnique({
            where: {
                conversationId_requesterId: {
                    conversationId,
                    requesterId: userId
                }
            }
        });

        if(!request) {
            throw new NotFoundException('Join request not found');
        }

        if(request.status !== JoinRequestStatus.PENDING) {
            throw new ConflictException('Only pending join requests can be cancelled');
        }

        return this.prisma.conversationJoinRequest.update({
            where: { id: request.id },
            data: {
                status: JoinRequestStatus.CANCELLED,
            },
            select: {
                id: true,
                status: true,
                updatedAt: true
            }
        });
    }

}
