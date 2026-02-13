import { ChatOpenAI } from "@langchain/openai";
import { env } from "../../env.js";
import {
  Command,
  END,
  GraphNode,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "langchain";
import z from "zod";

const llm = new ChatOpenAI({
  model: "gpt-4.1-mini",
  // model: 'gpt-5-nano',
  apiKey: env.OPENAI_API_KEY,
  streaming: true,
});

const overallState = new StateSchema({
  messages: MessagesValue,
  objective: z.string(),
});
type OverallState = typeof overallState;

const CONVERSATION_NODE = "conversationNode";
const conversationNode: GraphNode<OverallState> = async (state, config) => {
  const schema = z.object({
    reason: z.string(),
    objective: z.string().nullable(),
    isVague: z.boolean(),
  });
  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
    streaming: true,
  }).withStructuredOutput(schema, {
    includeRaw: true
  });
  const systemPrompt = new SystemMessage(`
    your goal is to ask user question to make sure they know what they're asking for,
    before heading to the next step. this is to ensure the planner comes up with the most
    accurate plan relavent for the user.
    `);
  const response = await model.invoke([systemPrompt, ...state.messages]);

  if (response.parsed.isVague && !response.parsed.objective) {
    return new Command({
      update: {
        messages: response.parsed.reason,
      },
      goto: END,
    });
  } else {
    return new Command({
      update: {
        messages: response.parsed.reason,
        objective: response.parsed.objective,
      },
      goto: PLANNER_NODE,
    });
  }
};

const PLANNER_NODE = "plannerNode";
const plannerNode: GraphNode<OverallState> = async (state) => {
  console.log("at plannerNode");
  return state;
};

const workflow = new StateGraph(overallState)
  .addNode(CONVERSATION_NODE, conversationNode, {
    ends: [PLANNER_NODE, END],
  })
  .addNode(PLANNER_NODE, plannerNode)
  .addEdge(START, CONVERSATION_NODE)
  .addEdge(PLANNER_NODE, END);

export const agent = workflow.compile({
  checkpointer: new MemorySaver(),
});
