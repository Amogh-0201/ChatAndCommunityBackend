import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { MessageService } from './message.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('messages')
export class MessageController {
  
  constructor(private readonly messageService: MessageService) {}

  @Post()
  create(@Body() dto: CreateMessageDto) {
    return this.messageService.create(dto);
  }

  @Get('/between/:userA/:userB')
  getConversation(
    @Param('userA', ParseUUIDPipe) userA: string,
    @Param('userB', ParseUUIDPipe) userB: string
  ) {
    return this.messageService.getConversation(userA, userB);
  }
}
