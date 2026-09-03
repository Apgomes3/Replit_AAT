/**
 * Keeps numeric-field behavior consistent without requiring every form to
 * remember a special component. Literal JSX <input type="number"> elements
 * become MathNumberInput elements during the React transform.
 */
export default function mathNumberInputBabelPlugin({ types: t }: any) {
  return {
    name: 'math-number-inputs',
    visitor: {
      Program: {
        enter(_path: any, state: any) {
          state.mathNumberInputUsed = false;
        },
        exit(path: any, state: any) {
          if (!state.mathNumberInputUsed || path.scope.hasBinding('MathNumberInput')) return;
          path.unshiftContainer('body', t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier('MathNumberInput'))],
            t.stringLiteral('@web/components/ui/MathNumberInput'),
          ));
        },
      },
      JSXElement(path: any, state: any) {
        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name, { name: 'input' })) return;
        const isNumeric = opening.attributes.some((attribute: any) =>
          t.isJSXAttribute(attribute)
          && t.isJSXIdentifier(attribute.name, { name: 'type' })
          && t.isStringLiteral(attribute.value, { value: 'number' }));
        if (!isNumeric) return;

        opening.name = t.jsxIdentifier('MathNumberInput');
        if (path.node.closingElement) {
          path.node.closingElement.name = t.jsxIdentifier('MathNumberInput');
        }
        state.mathNumberInputUsed = true;
      },
    },
  };
}
