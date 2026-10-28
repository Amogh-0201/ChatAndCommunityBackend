import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "../../lib/database/prisma.module";
import { UserModule } from "../user/user.module";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";

@Module({
    imports: [
        UserModule,
        PrismaModule,
        PassportModule.register({
            defaultStrategy: 'jwt'
        }),
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                secret: configService.getOrThrow<string>(
                    'JWT_ACCESS_SECRET',
                ),
                signOptions: {
                    algorithm: 'HS256',
                    expiresIn: '15m',
                    issuer: configService.getOrThrow<string>('JWT_ISSUER'),
                    audience: configService.getOrThrow<string>('JWT_AUDIENCE')
                }
            })
        })
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        JwtAuthGuard,
        {
            provide: APP_GUARD,
            useExisting: JwtAuthGuard
        }
    ],
    exports: [JwtAuthGuard]
})
export class AuthModule {}