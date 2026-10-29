import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../lib/database/prisma.service";
import { Socket } from "socket.io";
import { SocketAuthUser } from "../../auth/types/socket-auth-user";
import { WsException } from "@nestjs/websockets";

@Injectable()
export class WsSessionGuard implements CanActivate {
    
    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean>{
        
        const client = context.switchToWs().getClient<Socket>();

        const authUser = client.data.authUser as SocketAuthUser | undefined;

        if(!authUser || Date.now() >= authUser.expiresAt) {
            client.disconnect(true);
            throw new WsException('Unauthorized');
        }

        const session = await this.prisma.authSession.findFirst({
            where: {
                id: authUser.sessionId,
                userId: authUser.id,
                revokedAt: null,
                expiresAt: { gt: new Date() }
            },
            select: { id: true }
        });

        if(!session) {
            client.disconnect(true);
            throw new WsException('Unauthorized');
        }

        return true;
    }
}