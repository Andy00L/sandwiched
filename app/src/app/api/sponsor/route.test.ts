import { expect, test } from "bun:test";
import { MAX_SPONSOR_BODY_BYTES } from "@/lib/chain/sponsor-service";
import { POST } from "./route";

test("refuses a body whose declared length is over the limit without reading it", async () => {
  let pulledChunks = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulledChunks += 1;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("http://localhost/api/sponsor", {
    method: "POST",
    headers: { "content-length": String(MAX_SPONSOR_BODY_BYTES + 1) },
    body,
  });
  const response = await POST(request);
  expect(response.status).toBe(413);
  expect(pulledChunks).toBe(0);
});
