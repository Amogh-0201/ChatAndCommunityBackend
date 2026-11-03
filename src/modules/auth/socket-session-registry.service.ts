import { Injectable } from "@nestjs/common";
import { Socket } from "socket.io";

@Injectable()
export class SocketSessionRegistry {

    private readonly socketsBySession = new Map<string, Set<Socket>>();
    private readonly socketsByUser = new Map<string, Set<Socket>>();

    register(sessionId: string, userId: string, socket: Socket): boolean {
        
        // Track sockets belonging to this session.
        let sessionSockets = this.socketsBySession.get(sessionId);

        if(!sessionSockets) {
            sessionSockets = new Set<Socket>();
            this.socketsBySession.set(sessionId, sessionSockets);
        }

        sessionSockets.add(socket);

        // Track sockets belonging to this user.
        let userSockets = this.socketsByUser.get(userId);

        const isFirstConnection = !userSockets || userSockets.size === 0;

        if(!userSockets) {
            userSockets = new Set<Socket>();
            this.socketsByUser.set(userId, userSockets);
        }

        userSockets.add(socket);

        // True only when the user transitions from offline to online.
        return isFirstConnection;
    }

    unregister(sessionId: string, userId: string, socket: Socket): boolean {
        
        // Remove from session tracking.
        const sessionSockets = this.socketsBySession.get(sessionId);

        if(sessionSockets) {
            sessionSockets.delete(socket);
            if(sessionSockets.size === 0) {
                this.socketsBySession.delete(sessionId);
            }
        }

        // Remove from user tracking.
        const userSockets = this.socketsByUser.get(userId);

        if(!userSockets) return false;

        userSockets.delete(socket);

        if(userSockets.size === 0) {
            this.socketsByUser.delete(userId);
            // True only when the user transitions from online to offline.
            return true;
        }

        return false;
    }

    isUserOnline(userId: string): boolean {
        return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
    }

    getOnlineUserIds(): string[] {
        return [...this.socketsByUser.keys()];
    }

    disconnectSession(sessionId: string) {
        
        const sockets = this.socketsBySession.get(sessionId);

        if (!sockets) {
            return;
        }

        // Copy the set because disconnect triggers cleanup.
        for(const socket of [...sockets]) {
            socket.disconnect(true);
        }
    }

    disconnectSessions(sessionIds: string[]) {
        
        for(const sessionId of sessionIds) {
            this.disconnectSession(sessionId);
        }
    }
}