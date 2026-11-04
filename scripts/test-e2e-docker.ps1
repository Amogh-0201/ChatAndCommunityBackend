$ErrorActionPreference = 'Stop'

$containerName = "chat-community-test-db-$PID"
$databaseName = 'chat_community_test'
$databaseUser = 'postgres'
$databasePassword = 'test_only_password'
$databasePort = if ($env:TEST_DATABASE_PORT) {
    $env:TEST_DATABASE_PORT
} else {
    '55432'
}

if ($databasePort -notmatch '^\d{1,5}$' -or [int]$databasePort -lt 1 -or [int]$databasePort -gt 65535) {
    throw 'TEST_DATABASE_PORT must be a TCP port between 1 and 65535.'
}

$previousDatabaseUrl = $env:DATABASE_URL
$previousTestDatabaseUrl = $env:TEST_DATABASE_URL
$testDatabaseUrl = "postgresql://${databaseUser}:${databasePassword}@127.0.0.1:${databasePort}/${databaseName}?schema=public"
$containerStarted = $false

try {
    Write-Host "Starting temporary PostgreSQL test database on port $databasePort..."
    $containerId = & docker run `
        --detach `
        --name $containerName `
        --publish "127.0.0.1:${databasePort}:5432" `
        --env "POSTGRES_DB=$databaseName" `
        --env "POSTGRES_USER=$databaseUser" `
        --env "POSTGRES_PASSWORD=$databasePassword" `
        --health-cmd "pg_isready -U $databaseUser -d $databaseName" `
        --health-interval 2s `
        --health-timeout 3s `
        --health-retries 30 `
        postgres:17-alpine

    if ($LASTEXITCODE -ne 0) {
        throw 'Docker could not start the PostgreSQL test container.'
    }
    $containerStarted = $true

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $health = & docker inspect --format '{{.State.Health.Status}}' $containerName
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not inspect the PostgreSQL test container health.'
        }
        if ($health -eq 'healthy') {
            $ready = $true
            break
        }
        if ($health -eq 'unhealthy') {
            & docker logs $containerName
            throw 'The PostgreSQL test container became unhealthy.'
        }
        Start-Sleep -Seconds 1
    }

    if (-not $ready) {
        & docker logs $containerName
        throw 'PostgreSQL did not become ready within 60 seconds.'
    }

    $env:DATABASE_URL = $testDatabaseUrl
    $env:TEST_DATABASE_URL = $testDatabaseUrl

    Write-Host 'Applying Prisma migrations to the temporary database...'
    & npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) {
        throw 'Prisma migrations failed.'
    }

    Write-Host 'Running REST and Socket.IO integration tests...'
    & npm run test:e2e -- --runInBand
    if ($LASTEXITCODE -ne 0) {
        throw 'The end-to-end test suite failed.'
    }

    Write-Host 'All end-to-end tests passed.'
} finally {
    if ($null -eq $previousDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $previousDatabaseUrl
    }

    if ($null -eq $previousTestDatabaseUrl) {
        Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
    }

    if ($containerStarted) {
        Write-Host 'Removing the temporary PostgreSQL test container...'
        & docker rm --force --volumes $containerName
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Could not remove container $containerName. Remove it with: docker rm --force $containerName"
        }
    }
}
