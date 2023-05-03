module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Warn if save() or destroy() is called on an object called "cube"',
      category: 'Possible Errors',
      recommended: true
    },
    fixable: null,
    schema: []
  },
  create: function (context) {
    return {
      CallExpression: function (node) {
        if (node.callee.object && node.callee.object.name === 'cube') {
          if (node.callee.property && node.callee.property.name === 'save') {
            context.report({
              node,
              message: 'Make sure you encode the cube id before calling save(), or call $saveWithEncode instead.'
            })
          }
          if (node.callee.property && node.callee.property.name === 'destroy') {
            context.report({
              node,
              message: 'Make sure you encode the cube id before calling destroy()'
            })
          }
        }
      }
    }
  }
}
