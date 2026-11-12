import { readFileSync } from 'node:fs';

import ts from 'typescript-6';

/** The same wording for generated prop descriptions and API headings. */
export function addedIn(version: string): string {
  return `Added in: ${version === 'next' ? 'next release' : `v${version.replace(/^v/, '')}`}`;
}

/** Reads the annotation on a declaration, including ambient soundor modules. */
export function apiVersion(path: string, name: string): string {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  let version: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = true;
      const tag = ts
        .getJSDocTags(node)
        .find((tag) => tag.tagName.text === 'since');
      if (typeof tag?.comment === 'string') version = tag.comment.trim();
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (version === undefined)
    throw new Error(
      `${path}: ${found ? `${name} has no @since annotation` : `there is no declaration named ${name}`}`,
    );
  return version;
}
