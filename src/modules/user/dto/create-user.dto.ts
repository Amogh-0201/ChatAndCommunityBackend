import { IsString, MaxLength, MinLength, Matches } from "class-validator";
import {Transform} from "class-transformer"

export class CreateUserDto {
    
    @IsString()
    @MinLength(3)
    @MaxLength(30)
    @Transform(({value}) => 
        typeof value === 'string' ? value.trim() : value
    )
    name: string;

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
    username: string

    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: 'Phone number must use E.164 format',
    })
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    phoneNumber: string;

    @IsString()
    @MinLength(6)
    @MaxLength(128)
    password: string;
}