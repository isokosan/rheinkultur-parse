module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce consistent naming when extending Parse classes',
      category: 'Best Practices',
      recommended: true
    }
  },

  create: function (context) {
    return {
      CallExpression: function (node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.name === 'extend' &&
          node.callee.object.property.name === 'Object' &&
          node.callee.object.object.name === 'Parse' &&
          node.parent.type === 'VariableDeclarator' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal' &&
          node.parent.id.type === 'Identifier' &&
          node.parent.init === node
        ) {
          const className = node.arguments[0].value
          const variableName = node.parent.id.name

          if (className !== variableName) {
            context.report({
              node,
              message: `Variable name for class '${variableName}' does not match the class name '${className}'`
            })
          }
        }
      }
    }
  }
}
