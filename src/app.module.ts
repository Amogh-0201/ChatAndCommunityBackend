import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { MessageModule } from './modules/message/message.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationModule } from './modules/conversation/conversation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    UserModule, 
    MessageModule,
    AuthModule,
    ConversationModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
