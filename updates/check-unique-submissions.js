// SHOULD RETURN EMPTY ARRAY
const { upperFirst, camelCase } = require('lodash')
const getSubmissionClass = type => upperFirst(camelCase(type)) + 'Submission'
require('./run')(async () => {
  // check every task list
  const uniqueViolations = []
  await $query('TaskList')
    // .equalTo('objectId', 'cIJjWRcBjV')
    .select('objectId', 'type')
    .eachBatch(async (taskLists) => {
      for (const taskList of taskLists) {
        // check if any cube appears more than once
        const violations = await $query(getSubmissionClass(taskList.get('type')))
          .aggregate([
            { $match: { _p_taskList: 'TaskList$' + taskList.id } },
            { $group: { _id: '$cube', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } }
          ], { useMasterKey: true })
        for (const { objectId } of violations) {
          uniqueViolations.push({ listId: taskList.id, cubeId: objectId })
        }
        violations.length && console.log(violations)
      }
    }, { useMasterKey: true })
  console.log(uniqueViolations)
  console.log(uniqueViolations.length)
})
