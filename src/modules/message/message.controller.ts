import { Controller, Get, Req, Param, ParseUUIDPipe, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { MessageService } from './message.service';
import type { Request } from 'express';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    username: string;
    sessionId: string;
  };
};

@Controller()
export class MessageController {
  
  constructor(private readonly messageService: MessageService) {}

  @Get('conversations/:conversationId/messages')
  getConversationMessages(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string
  ) {
    return this.messageService.getConversationMessages(conversationId, req.user.id, limit, cursor);
  }
}
