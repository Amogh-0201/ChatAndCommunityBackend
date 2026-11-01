
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { GroupJoinPolicy } from '../../../generated/prisma/client';

export class UpdateConversationDto {
    
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsEnum(GroupJoinPolicy)
  joinPolicy?: GroupJoinPolicy;
}
