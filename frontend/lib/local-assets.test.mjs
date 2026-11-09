import assert from "node:assert/strict";
import { test } from "node:test";
import { localImage } from "./local-assets.ts";
test("avatars and app icons use uploaded or bundled assets only", () => {
  for (const value of ["/icon.png", "data:image/png;base64,AA==", "blob:http://localhost/recording"]) assert.equal(localImage(value), true);
  for (const value of [null, "", "https://example.com/icon.png", "//example.com/icon.png", "/\\example.com/icon.png", "/\n/example.com/icon.png", "data:image/svg+xml,<svg/>"]) assert.equal(localImage(value), false);
});
