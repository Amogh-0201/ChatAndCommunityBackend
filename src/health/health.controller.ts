import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../lib/database/prisma.service';
import { Public } from '../modules/auth/decorators/public.decorator';

@Controller('health')
export class HealthController {

    constructor(private readonly prismaService: PrismaService) {}

    // 1. Liveness check
    @Public()
    @Get('live')
    checkLiveness() {
        return {
            status: 'ok',
            service: 'chat-community-api'
        };
    }

    // 2. Readiness check
    @Public()
    @Get('ready')
    async checkReadiness() {
        try {
            // Check whether PostgreSQL is reachable
            await this.prismaService.$queryRaw`SELECT 1`;

            return {
                status: 'ok',
                checks: {
                    database: 'connected'
                }
            };
        } catch(error) {
            throw new ServiceUnavailableException({
                status: 'error',
                checks: {
                    database: 'disconnected'
                }
            });
        }
    }

}
