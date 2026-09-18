import { describe, expect, it } from "vitest";
import { RingBuffer } from "./terminal.js";

describe("RingBuffer", () => {
  it("returns everything pushed while under the limit", () => {
    const ring = new RingBuffer(1024);
    ring.push("hello ");
    ring.push("world");
    expect(ring.value).toBe("hello world");
  });

  it("keeps only the last N bytes once over the limit", () => {
    const ring = new RingBuffer(10);
    ring.push("0123456789"); // exactly at the limit
    expect(ring.value).toBe("0123456789");
    ring.push("ABC"); // pushes it over
    expect(ring.value).toBe("3456789ABC");
    expect(ring.value.length).toBe(10);
  });

  it("trims correctly across many small pushes", () => {
    const ring = new RingBuffer(5);
    for (const ch of "abcdefghij") ring.push(ch);
    expect(ring.value).toBe("fghij");
  });

  it("starts empty", () => {
    const ring = new RingBuffer();
    expect(ring.value).toBe("");
  });
});
