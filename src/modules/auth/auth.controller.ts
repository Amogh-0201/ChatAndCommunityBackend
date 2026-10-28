import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    username: string;
    sessionId: string;
  };
};

@Controller('auth')
export class AuthController {

    constructor(private readonly authService: AuthService) {}

    @Public()
    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    register(@Body() dto: CreateUserDto) {
        return this.authService.register(dto);
    }

    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK)
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Public()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    refresh(@Body() dto: RefreshTokenDto) {
        return this.authService.refresh(dto.refreshToken);
    }

    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    logout(@Body() dto: RefreshTokenDto) {
        return this.authService.logout(dto.refreshToken);
    }

    @Post('logout-all')
    @HttpCode(HttpStatus.OK)
    logoutAll(@Req() req: AuthenticatedRequest) {
        return this.authService.logoutAll(req.user.id);
    }
}