import { describe, it, expect } from "vitest";
import { csvEscape } from "@/lib/csv-export";

describe("csvEscape", () => {
  it("returns an empty string for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("passes plain strings through unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape("Engineering")).toBe("Engineering");
  });

  describe("RFC 4180 quoting", () => {
    it("wraps values containing a comma in quotes", () => {
      expect(csvEscape("Doe, Jane")).toBe('"Doe, Jane"');
    });

    it("doubles embedded double quotes and wraps in quotes", () => {
      expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""');
    });

    it("wraps values containing a newline in quotes", () => {
      expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    });

    it("wraps values containing a carriage return in quotes", () => {
      expect(csvEscape("line1\rline2")).toBe('"line1\rline2"');
    });
  });

  describe("formula-injection guard", () => {
    it("prefixes strings starting with = with a single quote", () => {
      expect(csvEscape("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    });

    it("prefixes strings starting with + with a single quote", () => {
      expect(csvEscape("+1234567")).toBe("'+1234567");
    });

    it("prefixes strings starting with - with a single quote", () => {
      expect(csvEscape("-1234567")).toBe("'-1234567");
    });

    it("prefixes strings starting with @ with a single quote", () => {
      expect(csvEscape("@cmd")).toBe("'@cmd");
    });

    it("prefixes strings starting with a tab", () => {
      // Tab alone isn't in the RFC-4180 quoting charset, so no surrounding quotes.
      expect(csvEscape("\tfoo")).toBe("'\tfoo");
    });

    it("prefixes strings starting with a carriage return, then quotes because CR also triggers RFC 4180 quoting", () => {
      expect(csvEscape("\rfoo")).toBe('"\'\rfoo"');
    });

    it("quotes on top of the prefix when the formula also contains a comma", () => {
      expect(csvEscape("=A1,B1")).toBe('"\'=A1,B1"');
    });
  });

  describe("numbers and booleans are exempt from the formula-injection prefix", () => {
    it("does not prefix a negative number", () => {
      expect(csvEscape(-5)).toBe("-5");
    });

    it("does not prefix a positive number", () => {
      expect(csvEscape(5)).toBe("5");
    });

    it("does not prefix booleans", () => {
      expect(csvEscape(true)).toBe("true");
      expect(csvEscape(false)).toBe("false");
    });
  });
});
