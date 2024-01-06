const OpenAI = require('openai')

const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
})

const openai = new OpenAI()
const assistantId = 'asst_jp11Pa6PutZBcD7vRRSMuqb0'

async function askQuestion (question) {
  return new Promise((resolve, reject) => {
    readline.question(question, (answer) => {
      resolve(answer)
    })
  })
}
async function main () {
  try {
    // const assistant = await openai.beta.assistants.create({
    //   name: "Math Tutor",
    //   instructions:
    //     "You are a personal math tutor. Write and run code to answer math questions.",
    //   tools: [{ type: "code_interpreter" }],
    //   model: "gpt-4-1106-preview",
    // });
    const assistant = await openai.beta.assistants.retrieve(assistantId)

    // Log the first greeting
    console.log(
      '\nYou can write anything to me.\n'
    )

    // Create a thread
    const thread = await openai.beta.threads.create()

    // Use keepAsking as state for keep asking questions
    let keepAsking = true
    while (keepAsking) {
      const userQuestion = await askQuestion('\nWhat is your question? ')

      // Pass in the user question into the existing thread
      await openai.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: userQuestion
      })

      // Use runs to wait for the assistant response and then retrieve it
      const run = await openai.beta.threads.runs.create(thread.id, {
        assistant_id: assistant.id
      })

      let runStatus = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      )

      // Polling mechanism to see if runStatus is completed
      // This should be made more robust.
      while (runStatus.status !== 'completed') {
        if (runStatus.status === 'requires_action') {
          console.log(JSON.stringify(runStatus))
          const { name, arguments: args } = runStatus.required_action.submit_tool_outputs.tool_calls[0].function
          console.log(name, args)
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        console.log(runStatus.status)
        runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id)
      }

      // Get the last assistant message from the messages array
      const messages = await openai.beta.threads.messages.list(thread.id)

      // Find the last message for the current run
      const lastMessageForRun = messages.data
        .filter(
          (message) => message.run_id === run.id && message.role === 'assistant'
        )
        .pop()

      // If an assistant message is found, console.log() it
      if (lastMessageForRun) {
        console.log(`${lastMessageForRun.content[0].text.value} \n`)
      }

      // Then ask if the user wants to ask another question and update keepAsking state
      const continueAsking = await askQuestion(
        'Do you want to ask another question? (yes/no) '
      )
      keepAsking = continueAsking.toLowerCase() === 'yes'

      // If the keepAsking state is falsy show an ending message
      if (!keepAsking) {
        console.log('Alrighty then, I hope you learned something!\n')
      }
    }

    // close the readline
    readline.close()
  } catch (error) {
    console.error(error)
  }
}

main()

/*
  example function call requires action response:
  {
    "id": "run_tISxqd9XSgPqTvV8ueoWbdb0",
    "object": "thread.run",
    "created_at": 1701443156,
    "assistant_id": "asst_jp11Pa6PutZBcD7vRRSMuqb0",
    "thread_id": "thread_1BCdpt4vGN7ClHRmkjm5DPjU",
    "status": "requires_action",
    "started_at": 1701443156,
    "expires_at": 1701443756,
    "cancelled_at": null,
    "failed_at": null,
    "completed_at": null,
    "required_action":
    {
        "type": "submit_tool_outputs",
        "submit_tool_outputs":
        {
            "tool_calls":
            [
                {
                    "id": "call_FUDGQMtRT0zRHagU4Cm47HEc",
                    "type": "function",
                    "function":
                    {
                        "name": "wawi_switch_contract_cubes",
                        "arguments": "{\n  \"contractNo\": \"23-0129\",\n  \"fromCubeId\": \"TLK-76656R2532\",\n  \"toCubeId\": \"TLK-76656A29\"\n}"
                    }
                }
            ]
        }
    },
    "last_error": null,
    "model": "gpt-4-1106-preview",
    "instructions": "You are an assistant chatbot on the ERP-CRM application of an advertising agency called Rheinkultur. Rheinkultur markets \"CityCubes\", telecommunications boxes in Germany, to advertisers for print ads. The system works with contracts with one or many CityCubes per contract, and runs for a period of time either auto extending or not. Your task is to assist the user and call some functions where applicable, from the API of the system.",
    "tools":
    [
        {
            "type": "function",
            "function":
            {
                "name": "wawi_switch_contract_cubes",
                "description": "Change the wrong CityCube in a contract out with the correct one, given the contract number, the wrong cube id and the correct cube id.",
                "parameters":
                {
                    "type": "object",
                    "properties":
                    {
                        "contractNo":
                        {
                            "type": "string",
                            "description": "Contract No (Eg. V23-0023)"
                        },
                        "fromCubeId":
                        {
                            "type": "string",
                            "description": "Wrong cube id"
                        },
                        "toCubeId":
                        {
                            "type": "string",
                            "description": "Correct cube id"
                        }
                    },
                    "required":
                    [
                        "contractNo",
                        "fromCubeId",
                        "toCubeId"
                    ]
                }
            }
        }
    ],
    "file_ids":
    [],
    "metadata":
    {}
  }
*/
