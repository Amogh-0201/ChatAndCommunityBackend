import { Transform } from "class-transformer";
import { GroupJoinPolicy } from "../../../generated/prisma/client";
import { IsEnum, IsOptional, IsString, Length } from "class-validator";

export class CreateGroupDto {

    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @IsString()
    @Length(1, 80)
    name: string;

    @IsOptional()
    @IsEnum(GroupJoinPolicy)
    joinPolicy?: GroupJoinPolicy;
}