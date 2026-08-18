import { z } from "zod";

export const SubjectSchema = z.enum(["quant", "verbal"]);
export type Subject = z.infer<typeof SubjectSchema>;
export const SafeHtmlSchema = z.string().max(1_000_000);
export const QuestionTypeSchema = z.enum([
  "Multiple Choice", "Multiple Select", "Numeric Entry (Fraction)", "Numeric Entry (Not Fraction)",
  "Quantitative Comparison", "TC 1 Blank", "TC 2 Blank", "TC 3 Blank", "Sentence Equivalence"
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const ChoiceSchema = z.object({ id: z.string(), label: z.string(), bodyHtml: SafeHtmlSchema, order: z.number().int().nonnegative() });
export const ChoiceGroupSchema = z.object({ id: z.string(), title: z.string(), choices: z.array(ChoiceSchema) });
export const AnswerSchemaByQuestionType = {
  "Multiple Choice": z.object({ question_id: z.string(), choice: z.string() }).strict(),
  "Multiple Select": z.object({ question_id: z.string(), choices: z.array(z.string()) }).strict(),
  "Numeric Entry (Fraction)": z.object({ question_id: z.string(), numerator: z.number().int(), denominator: z.number().int().refine(value => value !== 0) }).strict(),
  "Numeric Entry (Not Fraction)": z.object({ question_id: z.string(), value: z.number() }).strict(),
  "Quantitative Comparison": z.object({ question_id: z.string(), choice: z.enum(["A", "B", "C", "D"]) }).strict(),
  "TC 1 Blank": z.object({ question_id: z.string(), blank_1: z.string() }).strict(),
  "TC 2 Blank": z.object({ question_id: z.string(), blank_1: z.string(), blank_2: z.string() }).strict(),
  "TC 3 Blank": z.object({ question_id: z.string(), blank_1: z.string(), blank_2: z.string(), blank_3: z.string() }).strict(),
  "Sentence Equivalence": z.object({ question_id: z.string(), choices: z.array(z.string()).length(2) }).strict()
} as const;
export const AnswerSchema = z.union(Object.values(AnswerSchemaByQuestionType) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
export type Answer = z.infer<typeof AnswerSchema>;
export const QuestionSchema = z.object({
  id: z.string().regex(/^(quant|verbal):/), subject: SubjectSchema, type: QuestionTypeSchema,
  difficulty: z.enum(["Easy", "Medium", "Hard"]).nullable(), title: z.string(), promptHtml: SafeHtmlSchema,
  choiceGroups: z.array(ChoiceGroupSchema), correctChoiceIds: z.array(z.string()), answer: AnswerSchema.nullable(),
  scoring: z.object({ requiredCorrect: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  solution: z.object({ html: SafeHtmlSchema, videoId: z.string().nullable() }),
  metadata: z.object({ source: z.string().nullable(), acceptanceRate: z.number().nullable() })
}).superRefine((question, context) => {
  if (!question.answer) return;
  const answer = AnswerSchemaByQuestionType[question.type].safeParse(question.answer);
  if (!answer.success) context.addIssue({ code: z.ZodIssueCode.custom, path: ["answer"], message: `Answer does not match ${question.type}.` });
  else if (answer.data.question_id !== question.id) context.addIssue({ code: z.ZodIssueCode.custom, path: ["answer", "question_id"], message: "Answer belongs to a different question." });
});
export type Question = z.infer<typeof QuestionSchema>;
export const VideoCatalogSchema = z.object({
  subject: SubjectSchema, title: z.string(), categories: z.array(z.object({
    id: z.string(), title: z.string(), descriptionHtml: SafeHtmlSchema, videos: z.array(z.object({
      id: z.string(), title: z.string(), descriptionHtml: SafeHtmlSchema, durationSeconds: z.number().int().nullable(),
      mediaId: z.string(), categoryId: z.string(), order: z.number().int().nonnegative()
    }))
  }))
});
export type VideoCatalog = z.infer<typeof VideoCatalogSchema>;
export const CatalogEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) => z.object({
  schemaVersion: z.literal(1), contentVersion: z.string().regex(/^[a-f0-9]{12,64}$/), generatedAt: z.string(), subject: SubjectSchema, data
});
export const QuestionCatalogSchema = CatalogEnvelopeSchema(z.array(QuestionSchema));
export const VideoCatalogEnvelopeSchema = CatalogEnvelopeSchema(VideoCatalogSchema);
export type QuestionCatalog = z.infer<typeof QuestionCatalogSchema>;
export type VideoCatalogEnvelope = z.infer<typeof VideoCatalogEnvelopeSchema>;

export const AnswerSubmissionSchema = z.object({ selectedChoiceIds: z.array(z.string()).max(12).default([]), response: AnswerSchema.optional(), idempotencyKey: z.string().uuid() });
export const ProgressSchema = z.object({ positionSeconds: z.number().nonnegative(), watched: z.boolean(), completed: z.boolean(), idempotencyKey: z.string().uuid() });
