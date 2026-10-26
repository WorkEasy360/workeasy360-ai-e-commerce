import { describe, expect, it } from "vitest";
import { scriptUrls } from "./perf-budget.mjs";

describe("performance budget", () => {
  it("counts the page's own scripts once, and ignores third-party and inline ones", () => {
    const html = [
      '<script src="/_next/static/chunks/a.js" async=""></script>',
      '<script src="/_next/static/chunks/a.js"></script>',
      '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>',
      "<script>self.__next_f=[]</script>",
      '<script defer src="/_next/static/chunks/b.js?dpl=1&amp;v=2"></script>',
    ].join("");
    expect(scriptUrls(html, "http://localhost:3001/s/shop")).toEqual(["http://localhost:3001/_next/static/chunks/a.js", "http://localhost:3001/_next/static/chunks/b.js?dpl=1&v=2"]);
  });
});
