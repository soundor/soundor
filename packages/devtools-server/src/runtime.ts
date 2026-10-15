import { randomUUID } from 'node:crypto';

import {
  PROTOCOL_VERSION,
  registrationSchema,
  runtimeEventSchema,
  responseSchema,
  methodResults,
} from '@soundor/devtools-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { matches, secret, type Authentication } from './authentication';
import type { Session, Target } from './session';
import type { DevToolsServerOptions } from './types';

const MAX_TARGETS = 64;

export function registerRuntimeRoutes(
  app: FastifyInstance,
  auth: Authentication,
  session: Session,
  options: DevToolsServerOptions,
) {
  const { sessionId, token } = auth;
  const {
    targets,
    pending,
    broadcastTargets,
    disconnect,
    flush,
    publish,
    finish,
  } = session;
  async function runtimeAuth(
    request: FastifyRequest,
    response: FastifyReply,
  ): Promise<void> {
    if (
      request.headers.origin ||
      !matches(request.headers.authorization, `Bearer ${token}`) ||
      request.headers['x-soundor-session'] !== sessionId
    ) {
      response.code(401).send({ error: 'Runtime authentication required' });
      return;
    }
  }
  app.post(
    '/runtime/register',
    { onRequest: runtimeAuth },
    async (request, response) => {
      const parsed = registrationSchema.safeParse(request.body);
      if (!parsed.success) {
        response.code(400).send({
          error: {
            code: 'PROTOCOL_MISMATCH',
            message: 'Invalid registration or unsupported protocol version',
          },
        });
        return;
      }
      if (parsed.data.sessionId !== sessionId) {
        response.code(401).send({ error: 'Wrong session' });
        return;
      }
      if (
        options.supportedCapabilities &&
        parsed.data.capabilities.some(
          (capability) => !options.supportedCapabilities!.includes(capability),
        )
      ) {
        response.code(400).send({
          error: {
            code: 'MISSING_CAPABILITY',
            message: 'Instance capabilities exceed the runtime declaration',
          },
        });
        return;
      }
      if (targets.size >= MAX_TARGETS) {
        response.code(429).send({ error: 'Too many runtime instances' });
        return;
      }
      const { version: _version, sessionId: _sessionId, ...info } = parsed.data;
      const target: Target = {
        info: { ...info, id: randomUUID(), controller: null },
        token: secret(),
        lastSeen: Date.now(),
        queue: [],
      };
      targets.set(target.info.id, target);
      response.code(200).send({
        version: PROTOCOL_VERSION,
        targetId: target.info.id,
        targetToken: target.token,
      });
      broadcastTargets();
      options.onTarget?.(target.info);
      return;
    },
  );
  async function targetAuth(
    request: FastifyRequest,
    response: FastifyReply,
  ): Promise<void> {
    await runtimeAuth(request, response);
    if (response.sent) return;
    const id = request.headers['x-soundor-target'];
    const target = typeof id === 'string' ? targets.get(id) : undefined;
    if (
      !target ||
      !matches(
        typeof request.headers['x-soundor-target-token'] === 'string'
          ? request.headers['x-soundor-target-token']
          : undefined,
        target.token,
      )
    ) {
      response.code(401).send({ error: 'Target authentication required' });
      return;
    }
    target.lastSeen = Date.now();
  }
  app.get('/runtime/poll', { onRequest: targetAuth }, (request, response) => {
    const target = targets.get(request.headers['x-soundor-target'] as string)!;

    if (target.poll) {
      response.code(409).send({ error: 'One poll per target' });
      return;
    }
    target.poll = {
      response,
      timer: setTimeout(() => {
        target.poll = undefined;
        response.code(200).send({ commands: [] });
      }, 20000),
    };
    response.raw.on('close', () => {
      if (target.poll?.response === response) {
        clearTimeout(target.poll.timer);
        target.poll = undefined;
        if (!response.raw.writableEnded) disconnect(target);
      }
    });
    flush(target);
    return response;
  });
  app.post(
    '/runtime/messages',
    { onRequest: targetAuth },
    async (request, response) => {
      const target = targets.get(
        request.headers['x-soundor-target'] as string,
      )!;
      const value = request.body;
      const event = runtimeEventSchema.safeParse(value);
      if (event.success) {
        publish(target, event.data);
        response.code(200).send(null);
        return;
      }
      const parsed = responseSchema.safeParse(value);
      if (!parsed.success) {
        response.code(400).send({ error: 'Invalid runtime message' });
        return;
      }
      const operation = pending.get(parsed.data.id);
      if (!operation || operation.target !== target) {
        response.code(409).send({ error: 'Stale or foreign request' });
        return;
      }
      const result = parsed.data.result;
      const resultGeneration =
        result && typeof result === 'object'
          ? 'generation' in result
            ? result.generation
            : 'ref' in result &&
                result.ref &&
                typeof result.ref === 'object' &&
                'generation' in result.ref
              ? result.ref.generation
              : undefined
          : undefined;
      if (parsed.data.targetId && parsed.data.targetId !== target.info.id) {
        response.code(409).send({ error: 'Foreign target response' });
        return;
      }
      if (
        resultGeneration !== undefined &&
        resultGeneration !== target.info.generation
      ) {
        finish(parsed.data.id, undefined, {
          code: 'STALE_NODE',
          message: 'Response belongs to an old generation',
        });
      } else if (
        !parsed.data.error &&
        !methodResults[operation.request.method].safeParse(result).success
      ) {
        finish(parsed.data.id, undefined, {
          code: 'INVALID_REQUEST',
          message: 'Invalid runtime result',
        });
      } else finish(parsed.data.id, result, parsed.data.error);
      response.code(200).send(null);
      return;
    },
  );
  app.post(
    '/runtime/disconnect',
    { onRequest: targetAuth },
    async (request, response) => {
      const target = targets.get(
        request.headers['x-soundor-target'] as string,
      )!;
      disconnect(target);
      response.code(200).send(null);
      return;
    },
  );
}
