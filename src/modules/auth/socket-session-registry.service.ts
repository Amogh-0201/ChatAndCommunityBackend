import { Injectable } from "@nestjs/common";
import { Socket } from "socket.io";

@Injectable()
export class SocketSessionRegistry {

    private readonly socketsBySession = new Map<string, Set<Socket>>();

    register(sessionId: string, socket: Socket) {
        
        let sockets = this.socketsBySession.get(sessionId);

        if(!sockets) {
            sockets = new Set<Socket>();
            this.socketsBySession.set(sessionId, sockets);
        }

        sockets.add(socket);
    }

    unregister(sessionId: string, socket: Socket) {
        
        const sockets = this.socketsBySession.get(sessionId);

        if(!sockets) return;

        sockets.delete(socket);

        if(sockets.size === 0) {
            this.socketsBySession.delete(sessionId);
        }
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

        this.socketsBySession.delete(sessionId);
    }

    disconnectSessions(sessionIds: string[]) {
        
        for(const sessionId of sessionIds) {
            this.disconnectSession(sessionId);
        }
    }
}