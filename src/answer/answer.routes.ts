import type { FastifyInstance } from "fastify";
import { answerBody, usageQuery } from "./answer.schema.js";

/**
 * HTTP surface. Handlers stay thin — parse, delegate to `AnswerService`,
 * serialise. The streaming route is the only interesting one: it writes SSE
 * frames and wires client disconnect to an `AbortController` so a cancelled
 * request also cancels the model call.
 */
export async function answerRoutes(app: FastifyInstance): Promise<void> {
  const { answers, usage } = app.deps;

  app.post("/v1/answer", async (request) => {
    const body = answerBody.parse(request.body);
    return answers.answer(body.question, request.reqId, body.corpusTag);
  });

  app.post("/v1/answer/stream", async (request, reply) => {
    const body = answerBody.parse(request.body);

    // take over the socket — Fastify won't try to send its own response
    reply.hijack();

    const ac = new AbortController();
    request.raw.on("close", () => {
      if (!reply.raw.writableEnded) ac.abort();
    });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-request-id": request.reqId,
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const ev of answers.answerStream(body.question, request.reqId, {
        signal: ac.signal,
        corpusTag: body.corpusTag,
      })) {
        send(ev.type, ev);
      }
      send("end", {});
    } catch (err) {
      request.log.error({ err }, "stream failed");
      send("error", {
        code: (err as { code?: string }).code ?? "stream_error",
        title: (err as Error).message,
      });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/v1/usage/summary", async (request) => {
    const { windowHours } = usageQuery.parse(request.query);
    return usage.summary(windowHours);
  });
}
