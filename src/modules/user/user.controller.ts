import { Body, Controller, Get, Patch, Query, Req } from '@nestjs/common';
import { UserService } from './user.service';
import type { Request } from 'express'
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationDto } from './dto/pagination.dto';

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
  findAll(
    @Req() req: AuthenticatedRequeset,
    @Query() paginationDto: PaginationDto
  ) {
    return this.userService.findAll(req.user.id, paginationDto);
  }

  @Get("me")
  findOne(@Req() req: AuthenticatedRequeset) {
    return this.userService.findProfileById(req.user.id);
  }

  @Patch()
  update(
    @Req() req: AuthenticatedRequeset,
    @Body() dto: UpdateUserDto
  ) {
    return this.userService.updateUser(req.user.id, dto);
  }

}
