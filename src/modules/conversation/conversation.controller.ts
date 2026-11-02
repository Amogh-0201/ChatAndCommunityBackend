import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { Request } from 'express';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ReviewJoinRequestDto } from './dto/review-join-request.dto';

type AuthenticatedRequest = Request & {
    user : {
        id: string;
        username: string;
        sessionId: string;
    }
};

@Controller('conversations')
export class ConversationController {

    constructor(private readonly conversationService: ConversationService) {}

    // Get an existing direct conversation or create one
    @Post('direct/:otherUserId')
    getOrCreateDirectConversation(
        @Req() req: AuthenticatedRequest,
        @Param(':otherUserId', ParseUUIDPipe) otherUserId: string 
    ) {
        return this.conversationService.getOrCreateDirectConversation(req.user.id, otherUserId);
    }

    // Create a group
    @Post('groups')
    createGroup(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateGroupDto
    ) {
        return this.conversationService.createGroup(req.user.id, dto);
    }

    // list conversations belonging to the current user
    @Get()
    getMyConversations(@Req() req: AuthenticatedRequest) {
        return this.conversationService.getMyConversations(req.user.id);
    }

    // Get conversation details
    @Get(':id')
    getConversation(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string
    ) {
        return this.conversationService.getConversationDetails(conversationId, req.user.id);
    }

    // Update group name or join policy
    @Patch(':id')
    updateGroup(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string,
        @Body() dto: UpdateConversationDto
    ) {
        return this.conversationService.updateGroup(conversationId, req.user.id, dto);
    }

    // Join an OPEN group or request access to a REQUEST group
    @Post(':id/join')
    joinGroup(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string
    ) {
        return this.conversationService.joinGroup(conversationId, req.user.id);
    }

    // Leave a group
    @Delete(':id/leave')
    leaveGroup(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string
    ) {
        return this.conversationService.leaveGroup(conversationId, req.user.id);
    }

    // Owner lists pending join requests
    @Get(':id/join-requests')
    getJoinRequests(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string
    ) {
        return this.conversationService.getJoinRequests(conversationId, req.user.id);
    }

    // Owner approves or rejects a join request
    @Patch(':id/join-requests/:requestId')
    reviewJoinRequest(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string,
        @Param('requestId', ParseUUIDPipe) requestId: string,
        @Body() dto: ReviewJoinRequestDto
    ) {
        return this.conversationService.reviewJoinRequest(
            conversationId,
            requestId,
            req.user.id,
            dto
        );
    }

    // Current user cancels their own pending request
    @Delete(':id/join-requests/me')
    cancelJoinRequest(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseUUIDPipe) conversationId: string
    ) {
        return this.conversationService.cancelJoinRequest(conversationId, req.user.id);
    }

}
