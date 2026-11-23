// test values. In production these can be changed
// export const PRESENCE_LEASE_DURATION_MS = 60_000;
// export const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000;
// export const PRESENCE_CLEANUP_INTERVAL_MS = 10_000;

export const REGISTER_SOCKET_SCRIPT = `
    local added = redis.call('SADD', KEYS[1], ARGV[1])

    redis.call('SADD', KEYS[2], ARGV[1])

    redis.call('HSET', KEYS[3], 
        'userId', ARGV[2],
        'sessionId', ARGV[3],
        'serverId', ARGV[4],
        'connectedAt', ARGV[5]
    )

    redis.call('ZADD', KEYS[5], ARGV[6], ARGV[1])

    redis.call('SADD', KEYS[4], ARGV[2])

    local socketCount = redis.call('SCARD', KEYS[1])

    if added == 1 and socketCount == 1 then
        return 1
    end

    return 0
`;

export const UNREGISTER_SOCKET_SCRIPT = `
    local storedUserId = redis.call('HGET', KEYS[3], 'userId')
    local storedSessionId = redis.call('HGET', KEYS[3], 'sessionId')

    if storedUserId ~= ARGV[2] or storedSessionId ~= ARGV[3] then
        return 0
    end

    redis.call('SREM', KEYS[1], ARGV[1])
    redis.call('SREM', KEYS[2], ARGV[1])
    redis.call('ZREM', KEYS[5], ARGV[1])
    redis.call('DEL', KEYS[3])

    local sessionCount = redis.call('SCARD', KEYS[2])

    if sessionCount == 0 then
        redis.call('DEL', KEYS[2])
    end

    local userCount = redis.call('SCARD', KEYS[1])
    
    if userCount == 0 then
        redis.call('DEL', KEYS[1])
        
        local removed = redis.call('SREM', KEYS[4], ARGV[2])
        
        if removed == 1 then
            return 1
        end
    end

    return 0
`;

export const RENEW_SOCKET_LEASE_SCRIPT = `
    local userId = redis.call('HGET', KEYS[1], 'userId')

    if not userId then
        return 0
    end

    local currentExpiry = redis.call('ZSCORE', KEYS[2], ARGV[1])

    if not currentExpiry or tonumber(currentExpiry) <= tonumber(ARGV[2]) then
        return 0
    end

    redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])

    return 1
`;

export const CLEANUP_EXPIRED_SOCKETS_SCRIPT = `
    local expiredSockets = redis.call(
        'ZRANGEBYSCORE',
        KEYS[1],
        '-inf',
        ARGV[1],
        'LIMIT',
        0,
        ARGV[2]
    )
    
    local offlineUsers = {}

    for _, socketId in ipairs(expiredSockets) do

        local currentExpiry = redis.call('ZSCORE', KEYS[1], socketId)

        -- Recheck the score inside the atomic script.
        -- A heartbeat may have renewed this socket after it was selected.
        if currentExpiry and tonumber(currentExpiry) <= tonumber(ARGV[1]) then
            
            local metadataKey = ARGV[5] .. socketId
            local userId = redis.call('HGET', metadataKey, 'userId')
            local sessionId = redis.call('HGET', metadataKey, 'sessionId')

            if userId and sessionId then

                local userKey = ARGV[3] .. userId .. ':sockets'
                local sessionKey = ARGV[4] .. sessionId .. ':sockets'

                redis.call('SREM', userKey, socketId)
                redis.call('SREM', sessionKey, socketId)
                redis.call('DEL', metadataKey)

                if redis.call('SCARD', sessionKey) == 0 then
                    redis.call('DEL', sessionKey)
                end

                if redis.call('SCARD', userKey) == 0 then
                    redis.call('DEL', userKey)

                    local removed = redis.call(
                        'SREM',
                        KEYS[2],
                        userId
                    )
                    
                    if removed == 1 then
                        table.insert(offlineUsers, userId)
                    end
                end
            end
            
            -- Remove the lease even if its metadata is already missing.
            redis.call('ZREM', KEYS[1], socketId)
        end
    end

    return offlineUsers
`;