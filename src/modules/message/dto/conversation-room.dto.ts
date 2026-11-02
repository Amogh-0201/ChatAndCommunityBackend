import { IsUUID } from "class-validator";

export class ConversationRoomDto {
    @IsUUID()
    conversationId: string;
}