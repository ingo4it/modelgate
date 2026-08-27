import fp from "fastify-plugin";
import { ZodError } from "zod";
import { ApiError, type ProblemBody } from "./errors.js";

/** Terminal error handling → RFC 9457 problem+json. Unknown throws → bare 500. */
export const errorHandler = fp(
  (app, _opts, done) => {
    app.setErrorHandler((err, request, reply) => {
      const instance = `urn:modelgate:req:${request.reqId}`;
      let problem: ProblemBody;

      if (err instanceof ApiError) {
        problem = err.toProblem(instance);
        if (err.headers) reply.headers(err.headers);
      } else if (err instanceof ZodError) {
        problem = {
          type: "https://errors.modelgate.example.com/validation_failed",
          title: "Request body did not match the schema",
          status: 422,
          code: "validation_failed",
          detail: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          instance,
        };
      } else {
        request.log.error({ err }, "unhandled error");
        problem = {
          type: "https://errors.modelgate.example.com/internal",
          title: "Internal Server Error",
          status: 500,
          code: "internal",
          instance,
        };
      }

      reply.status(problem.status).type("application/problem+json").send(problem);
    });

    app.setNotFoundHandler((request, reply) => {
      reply
        .status(404)
        .type("application/problem+json")
        .send({
          type: "https://errors.modelgate.example.com/not_found",
          title: "Route not found",
          status: 404,
          code: "not_found",
          instance: `urn:modelgate:req:${request.reqId}`,
        });
    });

    done();
  },
  { name: "error-handler" },
);
