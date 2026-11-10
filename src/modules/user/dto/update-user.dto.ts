import { IsString, MaxLength, MinLength, Matches, IsOptional } from "class-validator";
import {Transform} from "class-transformer"


export class UpdateUserDto {

    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(30)
    @Transform(({value}) => 
        typeof value === 'string' ? value.trim() : value
    )
    name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9_]{3,30}$/, {
        message:
        'Username must be 3-30 characters: lowercase letters, numbers or underscores',
    })
    @Transform(({ value }) =>
        typeof value === 'string'
        ? value.trim().toLowerCase()
        : value,
    )
    username?: string
}