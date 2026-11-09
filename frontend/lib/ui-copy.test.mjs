import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { screenText } from "./screen-text.ts";
import { en } from "./i18n.ts";
const banned = /\bOpen (?:Dots|Duet)\b|\bagents?\b/i;
// Real CLI/package names and the HTTP header are technical identifiers.
const allowed = /cursor-agent|User-Agent|user-agent|@agentclientprotocol/g;
const forbidden = text => banned.test(text.replace(allowed, ""));
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(new URL(entry.name + "/", dir)) : [new URL(entry.name, dir)]);
test("English catalog uses the product name and bot wording", () => {
  for (const [key, value] of Object.entries(en)) assert.ok(!forbidden(value), `${key}: ${value}`);
});
test("frontend source prose uses the product name and bot wording", () => {
  const failures = [];
  for (const file of ["../components/", "../app/", "./"].flatMap(dir => files(new URL(dir, import.meta.url))).filter(file => /\.tsx?$/.test(file.pathname) && !file.pathname.includes("/locales/"))) {
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      const literal = ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      const text = ts.isJsxText(node) ? node.getText(ast) : literal ? node.text : "";
      const visibleAttribute = node.parent && ts.isJsxAttribute(node.parent) && ["title", "label", "placeholder", "description", "aria-label", "alt"].includes(node.parent.name.getText(ast));
      const prose = ts.isJsxText(node) || (literal && (visibleAttribute || /\s/.test(text)) && !text.startsWith("@/") && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node));
      if (prose && forbidden(text)) failures.push(`${file.pathname}: ${text}`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(failures, []);
});

test("older catalog and error copy preserves genuine command names", () => {
  assert.equal(screenText("Open Duet: per-agent access"), "Chief of Noumenon: per-bot access");
  assert.equal(screenText("Run cursor-agent to set up an ACP agent"), "Run cursor-agent to set up a custom command engine");
});
