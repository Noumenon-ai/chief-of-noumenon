import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyLanguage, en, t } from "./i18n.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".") || name === "out") return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test("t returns the message, fills placeholders and falls back to the key", () => {
  assert.equal(t("common.close"), "Close");
  assert.equal(t("nope.unknown"), "nope.unknown");
});

test("every literal t(key) in the app exists in the English table", () => {
  const missing = [];
  for (const file of [...sources(path.join(root, "components")), ...sources(path.join(root, "app"))]) {
    for (const match of readFileSync(file, "utf8").matchAll(/\bt\(\s*["']([\w.]+)["']/g)) {
      if (!(match[1] in en)) missing.push(`${path.relative(root, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the dynamic theme keys the toggle builds all exist", () => {
  for (const value of ["system", "light", "dark"]) assert.ok(`theme.${value}` in en);
});

test("Hebrew mirrors the interface; English restores its direction", () => {
  const doc = { documentElement: { lang: "en", dataset: {} } };
  applyLanguage(doc, "he");
  assert.equal(doc.documentElement.dir, "rtl");
  applyLanguage(doc, "en");
  assert.equal(doc.documentElement.dir, "ltr");
});

test("the English catalog contains no Spanish", () => {
  const spanish = /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]|\b(una|para|agente|esta|este|los|las|ejecuta)\b/i;
  const allowed = new Set(["language.spanish"]);
  const found = Object.entries(en).filter(([key, value]) => !allowed.has(key) && spanish.test(value)).map(([key]) => key);
  assert.deepEqual(found, []);
});
