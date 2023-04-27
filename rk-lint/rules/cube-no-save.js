module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Warn if save() is called on an object called "cube"',
      category: 'Possible Errors',
      recommended: true
    },
    fixable: null,
    schema: []
  },
  create: function (context) {
    return {
      CallExpression: function (node) {
        if (node.callee.property && node.callee.property.name === 'save' && node.callee.object && node.callee.object.name === 'cube') {
          context.report({
            node,
            message: 'Calling save() on a Cube object is not allowed. Please use $saveWithEncode instead.'
          })
        }
      }
    }
  }
}
