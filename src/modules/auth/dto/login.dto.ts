import { Transform } from "class-transformer";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class LoginDto {

    @IsString()
    @Matches(/^[a-z0-9_]{3,30}$/, {
        message:
        'Username must be 3-30 characters: lowercase letters, numbers or underscores',
    })
    @Transform(({value}) => 
        typeof value === 'string' ? value.trim().toLowerCase() : value
    )
    username: string

    @IsString()
    @MinLength(6)
    @MaxLength(128)
    password: string
}