import { Controller, Get, Req, Param, ParseUUIDPipe } from '@nestjs/common';
import { MessageService } from './message.service';
import type { Request } from 'express';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    username: string;
    sessionId: string;
  };
};

@Controller('messages')
export class MessageController {
  
  constructor(private readonly messageService: MessageService) {}

  @Get('between/:otherUserId')
  getConversation(
    @Req() req: AuthenticatedRequest,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string
  ) {
    return this.messageService.getConversation(req.user.id, otherUserId);
  }
}
