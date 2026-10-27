import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { PrismaModule } from '../../lib/database/prisma.module';
import { MessageGateway } from './message.gateway';

@Module({
  imports: [PrismaModule],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway],
  exports: [MessageService]
})
export class MessageModule {}
