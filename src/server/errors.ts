/** RFC 9457 problem+json, same shape as the other portfolio services. */
export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly headers?: Record<string, string>;

  constructor(args: { status: number; code: string; title: string; detail?: string; headers?: Record<string, string> }) {
    super(args.title);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.detail = args.detail;
    this.headers = args.headers;
  }

  toProblem(instance?: string): ProblemBody {
    return {
      type: `https://errors.modelgate.example.com/${this.code}`,
      title: this.message,
      status: this.status,
      detail: this.detail,
      instance,
      code: this.code,
    };
  }
}

export const Errors = {
  badQuestion: (detail: string) =>
    new ApiError({ status: 422, code: "invalid_question", title: "Question rejected by input guardrails", detail }),
  promptInjection: (detail: string) =>
    new ApiError({ status: 422, code: "prompt_injection_suspected", title: "Question rejected: injection heuristics", detail }),
  noContext: () =>
    new ApiError({
      status: 422,
      code: "no_retrievable_context",
      title: "Nothing in the corpus is relevant to this question",
    }),
  refused: (detail: string) =>
    new ApiError({ status: 422, code: "model_refused", title: "The model declined to answer", detail }),
  upstreamUnavailable: (detail: string) =>
    new ApiError({
      status: 503,
      code: "model_unavailable",
      title: "Both primary and fallback models failed",
      detail,
      headers: { "Retry-After": "5" },
    }),
  outputInvalid: (detail: string) =>
    new ApiError({ status: 502, code: "output_guardrail_failed", title: "Model output failed validation", detail }),
} as const;
