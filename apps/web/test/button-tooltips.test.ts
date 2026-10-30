import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps native titles off buttons and their children while retaining non-button data tooltips', () => {
  const violations: string[] = [];
  const dataTooltips = new Set<string>();
  const directory = new URL('../src/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, directory), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node, insideButton: boolean) {
      const button = ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'button'
        || ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'button';
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'title') {
        if (insideButton) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
        else dataTooltips.add(file);
      }
      ts.forEachChild(node, child => visit(child, insideButton || button));
    }
    visit(source, false);
  }
  expect(violations).toEqual([]);
  expect(dataTooltips.has('EnginePanel.tsx')).toBe(true);
  expect(dataTooltips.has('TimeManagementSummary.tsx')).toBe(true);
});
