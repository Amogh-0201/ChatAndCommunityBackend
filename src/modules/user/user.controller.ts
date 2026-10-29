import { Controller, Get, Req } from '@nestjs/common';
import { UserService } from './user.service';
import type { Request } from 'express'

type AuthenticatedRequeset = Request & {
  user: {
    id: string;
    username: string;
    sessionId: string;
  };
};

@Controller('user')
export class UserController {

  constructor(private readonly userService: UserService) {}

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get("me")
  findOne(@Req() req: AuthenticatedRequeset) {
    return this.userService.findProfileById(req.user.id);
  }
}
