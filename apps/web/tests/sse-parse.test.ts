import { describe, it, expect } from "vitest";
import { parseSseBlock } from "../src/server/sse-parse";

describe("sse-parse: parseSseBlock", () => {
  it('parses id+data block: "id: 1:5\\ndata: {\\"a\\":1}"', () => {
    const result = parseSseBlock('id: 1:5\ndata: {"a":1}');
    expect(result).toEqual({ id: "1:5", data: '{"a":1}' });
  });

  it("joins multiple data: lines with \\n", () => {
    const result = parseSseBlock("data: line1\ndata: line2");
    expect(result?.data).toBe("line1\nline2");
  });
});
