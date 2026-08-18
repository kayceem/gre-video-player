import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AnswerSchemaByQuestionType, QuestionCatalogSchema, VideoCatalogEnvelopeSchema } from "@gre/contracts";

const read = (name: string) => JSON.parse(gunzipSync(readFileSync(`generated/catalogs/${name}`)).toString("utf8"));
describe("generated catalogs", () => {
  it("contains independently valid question catalogs without source user fields", () => {
    for (const subject of ["quant", "verbal"]) {
      const catalog = QuestionCatalogSchema.parse(read(`questions-${subject}.json.gz`));
      expect(catalog.data.length).toBeGreaterThan(100);
      expect(JSON.stringify(catalog.data)).not.toMatch(/"(?:watched|saved|bookmarked|answer_attempts|user_answer_attempts)"/);
    }
  });
  it("contains valid, versioned video catalogs with local media IDs", () => {
    for (const subject of ["quant", "verbal"]) {
      const catalog = VideoCatalogEnvelopeSchema.parse(read(`videos-${subject}.json.gz`));
      expect(catalog.contentVersion).toMatch(/^[a-f0-9]{16}$/);
      expect(catalog.data.categories.flatMap(category => category.videos)).toSatisfy(videos => videos.every(video => video.mediaId.startsWith(`${subject}-`)));
      expect(catalog.data.categories.flatMap(category => category.videos)).toHaveLength(subject === "quant" ? 353 : 152);
    }
  });
  it("normalizes available answer keys to the question-type answer contract", () => {
    for (const subject of ["quant", "verbal"] as const) {
      const catalog = QuestionCatalogSchema.parse(read(`questions-${subject}.json.gz`));
      for (const question of catalog.data.filter(question => question.answer)) {
        expect(AnswerSchemaByQuestionType[question.type].parse(question.answer)).toEqual(question.answer);
        expect(question.answer!.question_id).toBe(question.id);
        expect(question.answer).not.toHaveProperty("type");
      }
    }
    const quantitativeComparison = QuestionCatalogSchema.parse(read("questions-quant.json.gz")).data.find(question => question.type === "Quantitative Comparison" && question.answer);
    expect(quantitativeComparison?.answer).toMatchObject({ choice: expect.stringMatching(/^[ABCD]$/) });
  });
});
