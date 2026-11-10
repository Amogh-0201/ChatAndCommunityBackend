import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as argon2 from 'argon2';
import {Prisma} from '../../generated/prisma/client'
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationDto } from './dto/pagination.dto';

@Injectable()
export class UserService {
    
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreateUserDto) {
        const passwordHash = await argon2.hash(dto.password);

        try {
            return await this.prisma.user.create({
                data: {
                    name: dto.name,
                    username: dto.username,
                    phoneNumber: dto.phoneNumber,
                    passwordHash: passwordHash,
                },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    phoneNumber: true,
                    createdAt: true
                }
            });
        } catch(error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException("Username or phone number already exists");
            }
            throw error;
        }
    }

    async findAll( paginationDto: PaginationDto ) {
        const page = paginationDto.page ?? 1;
        const limit = paginationDto.limit ?? 10;

        const skip = (page - 1)*limit;

        const [users, totalUsers] = await Promise.all([

            this.prisma.user.findMany({
                skip,
                take: limit,
                orderBy: [
                    { createdAt: 'desc' },
                    { id: 'desc' }
                ],
                select: {
                    id: true,
                    name: true,
                    username: true,
                    createdAt: true
                }
            }),

            this.prisma.user.count()
        ]);

        return {
            data: users,
            meta: {
                totalUsers,
                currentPage: page,
                limit,
                totalPages: Math.ceil(totalUsers / limit),
                hasNextPage: page * limit < totalUsers,
                hasPreviousPage: page > 1
            }
        };
    }

    async findProfileById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: {id},
            select: {
                id: true,
                name: true,
                username: true,
                phoneNumber: true,
                createdAt: true,
            }
        });

        if(!user) throw new NotFoundException("user not found");

        return user;
    }

    async findAuthUserByUsername(username: string) {
        return this.prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                name: true,
                username: true,
                phoneNumber: true,
                passwordHash: true,
                createdAt: true
            }
        });
    }

    async findAuthUserById(id: string) {
        return this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                username: true,
                phoneNumber: true,
                createdAt: true
            }
        });
    }

    async updateUser(id: string, updateUserDto: UpdateUserDto) {
        return this.prisma.user.update({
            where: { id },
            data: { ...updateUserDto },
            select: {
                id: true,
                name: true,
                username: true,
                phoneNumber: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }
}
