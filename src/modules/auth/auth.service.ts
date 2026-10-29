import { Injectable, UnauthorizedException } from "@nestjs/common";
import { UserService } from "../user/user.service";
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from "../../lib/database/prisma.service";
import { CreateUserDto } from "../user/dto/create-user.dto";
import { createHash, randomBytes, randomUUID } from "crypto";
import { LoginDto } from "./dto/login.dto";
import { SocketSessionRegistry } from './socket-session-registry.service';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type PublicUser = {
    id: string;
    name: string;
    username: string;
    phoneNumber: string;
    createdAt: Date;
};

@Injectable()
export class AuthService {

    constructor(
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly socketSessionRegistry: SocketSessionRegistry
    ){}

    async register(dto: CreateUserDto) {

        const user = await this.userService.create(dto);

        return await this.createTokenPair(user);
    }

    async login(dto: LoginDto) {

        const user = await this.userService.findAuthUserByUsername(dto.username);

        const passwordValid = user ? await argon2.verify(user.passwordHash, dto.password) : false;

        if(!user || !passwordValid) throw new UnauthorizedException("Invalid username or password");

        const publicUser: PublicUser = {
            id: user.id,
            name: user.name,
            username: user.username,
            phoneNumber: user.phoneNumber,
            createdAt: user.createdAt
        };

        return this.createTokenPair(publicUser);
    }

    async refresh(rawRefreshToken: string) {
        
        const now = new Date();
        const tokenHash = this.hashToken(rawRefreshToken);

        const existing = await this.prisma.refreshToken.findUnique({
            where: {
                tokenHash
            },
            include: {
                session: true
            }
        });

        if(!existing) throw new UnauthorizedException("Invalid Refresh Token");

        // A revoked token being presented again can indicate replay.
        // Revoke its whole session, including any newer refresh token.
        if(existing.revokedAt || existing.session.revokedAt) {
            await this.revokeSession(existing.sessionId, now);
            throw new UnauthorizedException('Invalid refresh token');
        }

        // An expired refresh token cannot be used to extend a session.
        if (
            existing.expiresAt.getTime() <= now.getTime() ||
            existing.session.expiresAt.getTime() <= now.getTime()
        ) {
            await this.revokeSession(existing.sessionId, now);
            throw new UnauthorizedException('Invalid refresh token');
        }

        const user =  await this.userService.findAuthUserById(existing.session.userId);
        if (!user) {
            await this.revokeSession(existing.sessionId, now);
            throw new UnauthorizedException('Invalid refresh token');
        }

        const publicUser: PublicUser = {
            id: user.id,
            name: user.name,
            username: user.username,
            phoneNumber: user.phoneNumber,
            createdAt: user.createdAt,
        };

        const nextRefreshToken = randomBytes(64).toString('base64url');
        const nextTokenHash = this.hashToken(nextRefreshToken);

        // Sliding idle expiry, capped by the session's fixed expiry.
        const nextRefreshExpiresAt = new Date(
            Math.min(
                now.getTime() + REFRESH_IDLE_TTL_MS,
                existing.session.expiresAt.getTime()
            )
        );

        const accessToken = await this.jwtService.signAsync({
            sub: user.id,
            sid: existing.sessionId
        });

        // The session row is updated first to serialize rotation against another refresh request and against logout.
        const rotationResult = await this.prisma.$transaction(async(tx) =>{
            const activeSession = await tx.authSession.updateMany({
                where: {
                    id: existing.sessionId,
                    userId: existing.session.userId,
                    revokedAt: null,
                    expiresAt: { gt: now }
                },
                data: {
                    lastUsedAt: now
                }
            });
            
            if(activeSession.count !== 1) return 'session-invalid' as const;

            // Consume the old refresh token exactly once.
            const consumed = await tx.refreshToken.updateMany({
                where: {
                    id: existing.id,
                    sessionId: existing.sessionId,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: {
                    revokedAt: now
                }
            });

            if(consumed.count !== 1) {
                // Another refresh consumed this token. Treat it as reuse and revoke the whole session.
                await tx.authSession.updateMany({
                    where: {
                        id: existing.sessionId,
                        revokedAt: null,
                    },
                    data: { revokedAt: now },
                });
                await tx.refreshToken.updateMany({
                    where: {
                        sessionId: existing.sessionId,
                        revokedAt: null,
                    },
                    data: { revokedAt: now },
                });

                return 'reused' as const;
            }

            await tx.refreshToken.create({
                data: {
                    tokenHash: nextTokenHash,
                    sessionId: existing.sessionId,
                    expiresAt: nextRefreshExpiresAt
                }
            });

            return 'rotated' as const;
        });

        if (rotationResult !== 'rotated') {
            await this.revokeSession(existing.sessionId, now);
            
            throw new UnauthorizedException('Invalid refresh token');
        }

        return {
            accessToken,
            refreshToken: nextRefreshToken,
            tokenType: 'Bearer',
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresAt: nextRefreshExpiresAt,
            sessionExpiresAt: existing.session.expiresAt,
            user: publicUser,
        };
    }

    async logout(rawRefreshToken: string) {
        
        const tokenHash = this.hashToken(rawRefreshToken);

        const token = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            select: { sessionId: true }
        });

        if(token) {
            this.revokeSession(token.sessionId);
        }

        return { success: true };
    }

    async logoutAll(userId: string) {

        const now = new Date();

        const sessionIds = await this.prisma.$transaction(async(tx) => {
            const sessions = await tx.authSession.findMany({
                where: {
                    userId,
                    revokedAt: null
                },
                select: { id: true }
            });
            
            if(sessions.length === 0) return [];

            const ids = sessions.map((session) => session.id);

            await tx.authSession.updateMany({
                where: {
                    id: { in: ids },
                    userId,
                    revokedAt: null
                },
                data: {
                    revokedAt: now
                }
            });
            await tx.refreshToken.updateMany({
                where: {
                    sessionId: { in: ids },
                    revokedAt: null
                },  
                data: {
                    revokedAt: now
                }
            });

            return ids;
        });

        this.socketSessionRegistry.disconnectSessions(sessionIds);

        return { success: true };
    }


    private async createTokenPair(user: PublicUser) {

        const now = new Date();
        const sessionId = randomUUID();

        const sessionExpiresAt = new Date(
            now.getTime() + REFRESH_SESSION_TTL_MS
        );

        const refreshTokenExpiresAt = new Date(
            Math.min(
                now.getTime() + REFRESH_IDLE_TTL_MS,
                sessionExpiresAt.getTime()
            )
        );

        // The raw refresh token is only returned to the client.
        const refreshToken = randomBytes(64).toString('base64url');
        const tokenHash = this.hashToken(refreshToken);

        const accessToken = await this.jwtService.signAsync({
            sub: user.id,
            sid: sessionId
        });

        // Create the session and its initial refresh token atomically.
        await this.prisma.$transaction(async(tx) =>{
            await tx.authSession.create({
                data: {
                    id: sessionId,
                    userId: user.id,
                    createdAt: now,
                    lastUsedAt: now,
                    expiresAt: sessionExpiresAt
                }
            });
            await tx.refreshToken.create({
                data: {
                    tokenHash,
                    sessionId,
                    expiresAt: refreshTokenExpiresAt
                }
            });
        });

        return {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenExpiresAt,
            sessionExpiresAt,
            user
        };
    }

    private hashToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private async revokeSession(sessionId: string, now = new Date()) {
        
        await this.prisma.$transaction(async(tx) => {
            await tx.authSession.updateMany({
                where: {
                    id: sessionId,
                    revokedAt: null
                },
                data: {
                    revokedAt: now
                }
            });
            await tx.refreshToken.updateMany({
                where: {
                    sessionId,
                    revokedAt: null
                },
                data: {
                    revokedAt: now
                }
            });
        });

        this.socketSessionRegistry.disconnectSession(sessionId);
    }
}