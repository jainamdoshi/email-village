import { describe, it, expect, mock } from "bun:test";

const pages: Record<string, { messages: Array<{ id: string }>; nextPageToken?: string }> = {
  first: { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" },
  p2: { messages: [{ id: "c" }] },
};
const listCalls: Array<{ q?: string; pageToken?: string }> = [];
let rateLimitedOnce = false;

mock.module("googleapis", () => ({
  google: {
    gmail: () => ({
      users: {
        messages: {
          list: async (params: { q?: string; pageToken?: string }) => {
            listCalls.push(params);
            return { data: pages[params.pageToken ?? "first"] };
          },
          get: async (params: { id: string }) => {
            if (params.id === "bad") {
              throw new Error("boom");
            }
            if (params.id === "limited" && !rateLimitedOnce) {
              rateLimitedOnce = true;
              throw {
                response: {
                  status: 403,
                  data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
                },
              };
            }
            return {
              data: { id: params.id, payload: { headers: [{ name: "From", value: `${params.id}@x.com` }] } },
            };
          },
        },
      },
    }),
  },
}));

const { listAllMessageIds, forEachMessageHeaders } = await import(
  "../../src/gmail/client.js"
);
const auth = {} as Parameters<typeof listAllMessageIds>[0];

describe("listAllMessageIds", () => {
  it("follows every page and passes the query through", async () => {
    const ids = await listAllMessageIds(auth, "newer_than:1d");
    expect(ids).toEqual(["a", "b", "c"]);
    expect(listCalls.map((c) => c.pageToken)).toEqual([undefined, "p2"]);
    expect(listCalls.every((c) => c.q === "newer_than:1d")).toBe(true);
  });
});

describe("forEachMessageHeaders", () => {
  it("counts failures, retries rate limits and visits the rest", async () => {
    const seen: string[] = [];
    const result = await forEachMessageHeaders(
      auth,
      ["a", "bad", "limited", "b"],
      ["From"],
      (m) => seen.push(m.id ?? "")
    );
    expect(result).toEqual({ fetched: 3, failed: 1 });
    expect(seen.sort()).toEqual(["a", "b", "limited"]);
    expect(rateLimitedOnce).toBe(true);
  });
});
