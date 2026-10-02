# NestJS — WebSocket Gateways and Microservice Transports

## Contents
- Gateways: where authentication runs
- Gateways: authorization and rooms
- Gateways: origin and message handling
- Microservices: trust model
- TCP transport
- Broker transports
- Hybrid applications
- Pipes, filters and DoS
- False positives
- Verification

## Gateways: where authentication runs

Guards, pipes, interceptors and filters apply to `@SubscribeMessage()` handlers like HTTP routes, but throw `WsException` instead of `HttpException` (a guard returning `false` produces a `WsException('Forbidden resource')`). Global guards (`APP_GUARD`, `useGlobalGuards`) apply to gateways too.

**`handleConnection()` is not guarded.** In `WebSocketsController` it is subscribed and called directly (`handlerOrGateway.handleConnection.bind(...)`), so no guard, pipe or interceptor runs for the connection event; Nest 12's `@nestjs/authentication` docs state the same. Authentication of the handshake must be coded inside `handleConnection()` (or a socket.io middleware / custom adapter `createIOServer` with `server.use(...)`).

Investigate:
- `handleConnection` empty, or it only logs. Identity later taken from `client.handshake.query.userId`, `handshake.headers['x-user-id']`, `handshake.auth.userId` or a message field (`data.userId`) without verification: impersonation.
- Token verified only at connect and never re-checked: revoked/expired sessions keep working. Per-message `@UseGuards()` checks catch this.
- `jwtService.decode()` instead of `verify()` on `handshake.auth.token`.
- Auth failure that logs but does not `client.disconnect(true)` (the connection stays open and messages are handled).
- `@UseGuards(AuthGuard)` only on some `@SubscribeMessage` handlers; the guard cannot read `request.user` from HTTP semantics (`context.switchToWs().getClient()` vs `getData()`), so a guard copied from HTTP may check the wrong object and fail open.

## Gateways: authorization and rooms

- `client.join(data.room)` / `@MessageBody() { roomId }` joining any room by name; rooms named by guessable tenant or user IDs. Broadcasts (`server.to(room).emit(...)`) then leak data across tenants. Derive rooms from the verified identity on the server.
- `server.emit(...)` (to everyone) with per-user data; sensitive events sent to a namespace instead of a room.
- Handlers that call services with client-supplied IDs without owner scoping (same IDOR rules as HTTP, `authorization.md`).
- `@WebSocketGateway({ cors: { origin: '*' } })` or `cors: true` with cookie authentication allows cross-site WebSocket connections that carry cookies (CSWSH). For cookie-authenticated sockets check the `Origin` header yourself (socket.io `allowRequest` or `cors.origin` list); the Nest 12.1 CSRF hook does not cover WebSocket upgrades.
- Message payload validation: put a `ValidationPipe` on the gateway (`@UsePipes(new ValidationPipe({ whitelist: true }))`) and throw `WsException` from `exceptionFactory`; global HTTP pipes apply, but DTO-less `@MessageBody() data: any` is unvalidated (`validation-mass-assignment.md`).
- Rate limiting: the stock `ThrottlerGuard` needs a WebSocket-specific subclass (`rate-limiting-dos.md`).

## Gateways: origin and message handling

- Socket.IO message size (`maxHttpBufferSize`, default 1 MB in v4) and ping settings; `ws` adapter `maxPayload`. Missing limits are DoS hardening.
- Unhandled exceptions in handlers: use `WsException` and `BaseWsExceptionFilter`; the default does not leak stacks to clients but custom filters might (`secrets-config.md`).

## Microservices: trust model

`@MessagePattern()` / `@EventPattern()` handlers execute whatever arrives on the transport. There is no HTTP layer, no CORS, and **no built-in authentication** on TCP, Redis, NATS, MQTT, Kafka or RabbitMQ transports (credentials, if any, belong to the broker). Anyone who can reach the listener or publish to the subject/topic/queue can invoke handlers.

## TCP transport

- `Transport.TCP` has no authentication or encryption by default. The server binds `localhost` by default (`TCP_DEFAULT_HOST = 'localhost'` in source for 10.x, 11.x and 12.x); `options: { host: '0.0.0.0' }` or a platform port mapping exposes it. TLS is configured with `tlsOptions` (key/cert on the server; `ca` on the client).
- Flag handlers that perform privileged work (role changes, payments, deletions, config) without verifying a caller identity in the payload (signed token) or network isolation.
- Version issues: DoS advisories for the TCP transport and message patterns (`GHSA-m8vh-jmq9-5rjg`, `CVE-2026-40879`, `GHSA-96h4-vgxj-gvm2`; see `dependencies.md`). Treat an internet-reachable TCP transport as High regardless.

## Broker transports

- Redis/NATS/MQTT/RabbitMQ/Kafka URLs with embedded credentials in source, brokers without auth or TLS, wildcard subscriptions (`'time.us.*'` NATS patterns) that accept more subjects than intended.
- Events published by one service trusted blindly by another: payloads must be validated and user identity must be propagated as signed claims, not as `userId` fields.
- Kafka/Rabbit consumers acknowledging before processing (loss) or poison-message loops (DoS): Hardening.

## Hybrid applications

`app.connectMicroservice(...)` handlers do **not** inherit the HTTP app's global pipes, interceptors, guards and filters, whether registered via `useGlobal*()` or the `APP_*` tokens, unless you pass `{ inheritAppConfig: true }` as the second argument. With `inheritAppConfig`, call `useGlobalPipes()`, `useGlobalGuards()` and the other `useGlobal*()` methods **before** `connectMicroservice()`. A global JWT guard therefore protects the HTTP side while the TCP/Redis handlers of the same codebase run unguarded and unvalidated. For a standard (non-hybrid) microservice app, `useGlobalGuards()` does apply.

Microservice guards throw `RpcException`; Nest 12.0 added a pre-request hook for microservices.

## Pipes, filters and DoS

- `ValidationPipe` in microservices must be configured with an `exceptionFactory` that returns `RpcException`, and applied explicitly (`@UsePipes`) or via `inheritAppConfig`.
- `@Payload() data: any`: unvalidated payloads reach services with the same injection/mass-assignment risks as HTTP.
- Pattern objects from the client are `JSON.stringify`ed by the framework; update to patched versions (`dependencies.md`).

## False positives

- TCP microservices bound to `localhost` or a private network with network policy, mTLS or a service mesh, called only by trusted services (state the assumption; Hardening).
- `handleConnection` that verifies the token with `jwtService.verify` and disconnects on failure, then uses the verified payload for rooms.
- Gateways broadcasting public data to all clients.
- Missing per-message guards when connection auth is strong, the session cannot be revoked mid-connection by design, and handlers are not privilege-sensitive.

## Verification

```ts
it('refuses unauthenticated sockets', (done) => {
  const socket = io(url, { autoConnect: true });
  socket.on('disconnect', () => done());
  socket.on('connect', () => socket.emit('join', { room: 'tenant:other' }));
});
```

For TCP: start the microservice in a test with `Test.createTestingModule` + `app.connectMicroservice(options, { inheritAppConfig: true })` and assert a handler call without credentials throws `RpcException`. In deployment review, confirm the listening address with `ss -ltnp` or the container port mapping.

References: https://docs.nestjs.com/websockets/gateways, /websockets/guards, /microservices/basics (TLS support), /faq/hybrid-application; OWASP WebSocket Security Cheat Sheet; CWE-306, CWE-1385, CWE-639, CWE-319.
