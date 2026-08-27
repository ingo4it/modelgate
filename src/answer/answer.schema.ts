import { z } from "zod";

export const answerBody = z.object({
  question: z.string().min(1),
  /** restrict retrieval to one logical corpus; omit to search all */
  corpusTag: z.string().min(1).optional(),
});

export type AnswerBody = z.infer<typeof answerBody>;

export const usageQuery = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});
