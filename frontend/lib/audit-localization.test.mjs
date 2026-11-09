import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { translate } from './i18n.ts';

test('Hebrew covers literal interface messages on the audited surfaces', () => {
  const root = new URL('../components/', import.meta.url);
  const files = readdirSync(root, {recursive:true}).filter(file => file.endsWith('.tsx') && /LocalApps|Apps|Marketplace|chat\/(agents|Agents|Memory|Skills|Routines|Planner|WorkItem|WorkExecution)|settings\/(Profile|Notifications|Engines)|EngineSettings/.test(file));
  const missing = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && ['t','tx'].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (translate('he', key) === translate('en', key)) missing.push(`${file}: ${key}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(missing, []);
});
