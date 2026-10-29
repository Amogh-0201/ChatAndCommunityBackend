import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../lib/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as argon2 from 'argon2';
import {Prisma} from '../../generated/prisma/client'

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

    async findAll() {
        return await this.prisma.user.findMany({
            take: 50,
            orderBy: {createdAt: 'desc'},
            select: {
                id: true,
                name: true,
                username: true,
                createdAt: true
            }
        });
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
}
