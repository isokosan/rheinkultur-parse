const triggers = ['beforeSave', 'afterSave', 'beforeFind', 'afterFind', 'beforeDelete', 'afterDelete']
const registeredTriggers = {}
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow duplicate registrations of ParseServer triggers',
      category: 'Possible Errors',
      recommended: true
    },
    schema: [] // no options needed for this rule
  },
  create: function (context) {
    return {
      CallExpression: function (node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'MemberExpression' &&
          node.callee.object.object.name === 'Parse' &&
          node.callee.object.property.name === 'Cloud' &&
          triggers.includes(node.callee.property.name) &&
          node.arguments.length >= 2
        ) {
          const [classExpression] = node.arguments
          const className = classExpression.name || classExpression.value
          const funcName = node.callee.property.name
          const key = `${funcName}_${className}`

          if (registeredTriggers[key]) {
            context.report({
              node,
              message: `Duplicate registration of '${funcName}' trigger for class '${className}'.`
            })
            return
          }
          registeredTriggers[key] = true
        }
      }
    }
  }
}
