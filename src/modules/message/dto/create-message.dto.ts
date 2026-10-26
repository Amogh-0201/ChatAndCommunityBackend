import { Transform } from 'class-transformer';
import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class CreateMessageDto {

    @IsUUID()
    senderId: string

    @IsUUID()
    recipientId: string

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
  content: string;
}