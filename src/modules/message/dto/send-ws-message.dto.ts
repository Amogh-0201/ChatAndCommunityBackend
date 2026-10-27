import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { Transform } from 'class-transformer';

export class SendWsMessageDto {

    @IsUUID()
    recipientId: string;

    @Transform(({value}) => 
        typeof value === 'string' ? value.trim() : value
    )
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    content: string;
}