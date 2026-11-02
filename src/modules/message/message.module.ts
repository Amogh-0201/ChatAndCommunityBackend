import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { PrismaModule } from '../../lib/database/prisma.module';
import { MessageGateway } from './message.gateway';
import { AuthModule } from '../auth/auth.module';
import { WsSessionGuard } from './guards/ws-session.guard';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [PrismaModule, AuthModule, ConversationModule],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway, WsSessionGuard],
  exports: [MessageService]
})
export class MessageModule {}
