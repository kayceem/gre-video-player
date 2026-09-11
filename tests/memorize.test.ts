import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { MountainData } from "../apps/web/src/mountain-types";

describe("Mountain Data Schema & Validation", () => {
    const dataDir = path.resolve(__dirname, "../apps/web/public/data");

    it("validates vocab_mountain.json schema and content", () => {
        const filePath = path.join(dataDir, "vocab_mountain.json");
        expect(fs.existsSync(filePath)).toBe(true);

        const data: MountainData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        expect(data.mountain_categories.length).toBe(34);

        const firstGroup = data.mountain_categories[0];
        expect(firstGroup.title).toBe("Group 1");
        expect(firstGroup.mountain_contents.length).toBeGreaterThan(0);

        const firstWord = firstGroup.mountain_contents[0];
        expect(firstWord.title).toBeDefined();
        expect(firstWord.slug).toBeDefined();
        expect(firstWord.description).toBeDefined();
    });

    it("validates quant_mountain.json schema and content", () => {
        const filePath = path.join(dataDir, "quant_mountain.json");
        expect(fs.existsSync(filePath)).toBe(true);

        const data: MountainData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        expect(data.mountain_categories.length).toBe(17);

        const firstGroup = data.mountain_categories[0];
        expect(firstGroup.mountain_contents.length).toBeGreaterThan(0);
        expect(firstGroup.mountain_contents[0].title).toBeDefined();
    });

    it("validates quant_mountain_overwhelmed.json schema and content", () => {
        const filePath = path.join(dataDir, "quant_mountain_overwhelmed.json");
        expect(fs.existsSync(filePath)).toBe(true);

        const data: MountainData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        expect(data.mountain_categories.length).toBe(48);

        const firstGroup = data.mountain_categories[0];
        expect(firstGroup.title).toBe("Arithmetic 1");
        expect(firstGroup.mountain_contents.length).toBeGreaterThan(0);
    });
});
