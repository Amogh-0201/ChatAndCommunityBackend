import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from "../../user/user.service";
import { PrismaService } from "../../../lib/database/prisma.service";


type AccessTokenPayload = {
    sub: string;
    sid: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {

    constructor(
        configService: ConfigService,
        private readonly userService: UserService,
        private readonly prisma: PrismaService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
            issuer: configService.getOrThrow<string>('JWT_ISSUER'),
            audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
            algorithms: ['HS256']
        });
    }

    async validate(payload: AccessTokenPayload) {

        if (
            typeof payload.sub !== 'string' ||
            typeof payload.sid !== 'string'
        ) {
            throw new UnauthorizedException();
        }

        const [user, session] = await Promise.all([
            this.userService.findAuthUserById(payload.sub),
            this.prisma.authSession.findFirst({
                where: {
                    id: payload.sid,
                    userId: payload.sub,
                    revokedAt: null,
                    expiresAt: { gt: new Date() }
                },
                select: { id: true }
            })
        ]);

        if(!user || !session) throw new UnauthorizedException();

        return {
            id: user.id,
            username: user.username,
            sessionId: session.id
        }
    }
}