import { ChatOpenAI } from "@langchain/openai";
import { env } from "../../env.js";
import {
  Command,
  END,
  GraphNode,
  interrupt,
  MemorySaver,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import {
  SystemMessage,
  HumanMessage,
  HITLRequest,
  HITLResponse,
} from "langchain";
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
  plan: z.array(z.string()),
});
type OverallState = typeof overallState;

const CONVERSATION_NODE = "conversationNode";
const conversationNode: GraphNode<OverallState> = async (state, config) => {
  const schema = z.object({
    reason: z.string(),
    objective: z.string().nullable(),
  });
  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
    streaming: true,
  }).withStructuredOutput(schema, {
    includeRaw: true,
  });
  const systemPrompt = new SystemMessage(`
    your goal is to ask user question to make sure they know what they're asking for,
    before heading to the next step. this is to ensure the planner comes up with the most
    accurate plan relavent for the user.
    `);
  const response = await model.invoke([systemPrompt, ...state.messages]);

  if (!response.parsed.objective) {
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
  const schema = z.object({
    plan: z.array(z.string()),
  });
  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
    streaming: true,
  }).withStructuredOutput(schema, {
    includeRaw: true,
  });
  const systemPrompt = new SystemMessage(`
    your goal is to come up with a plan based on the following objective:

    objective: ${state.objective}

    limit yourself to three plans
    `);
  const response = await model.invoke([systemPrompt, ...state.messages]);

  return new Command({
    update: {
      plan: response.parsed.plan,
    },
    goto: HUMAN_APPOVAL_NODE,
  });
};

const HUMAN_APPOVAL_NODE = "humanApprovalNode";
const humanApprovalNode: GraphNode<OverallState> = async (
  state,
): Promise<Command<OverallState>> => {
  console.log("at humanApprovalNode");
  const interruptRequest: HITLRequest = {
    actionRequests: [
      {
        name: "planReview",
        description: "Review the plan suggested by the planner",
        args: {},
      },
    ],
    reviewConfigs: [
      {
        actionName: "planReview",
        allowedDecisions: [
          "approve",
          "reject",
          // 'edit'
        ],
      },
    ],
  };

  const response: HITLResponse = interrupt(interruptRequest);
  if (response.decisions[0]?.type === "approve") {
    return new Command({
      goto: EXECUTOR_NODE,
    });
  } else {
    /**@todo handle this properly */
    return new Command({
      goto: END,
    });
  }
};

const EXECUTOR_NODE = "executorNode";
const executorNode: GraphNode<OverallState> = (state) => {
  console.log("at executorNode");
  console.log(state);
  return {};
};

const workflow = new StateGraph(overallState)
  .addNode(CONVERSATION_NODE, conversationNode, {
    ends: [PLANNER_NODE, END],
  })
  .addNode(PLANNER_NODE, plannerNode)
  .addNode(HUMAN_APPOVAL_NODE, humanApprovalNode, {
    ends: [EXECUTOR_NODE, END],
  })
  .addNode(EXECUTOR_NODE, executorNode)
  .addEdge(START, CONVERSATION_NODE)
  .addEdge(PLANNER_NODE, HUMAN_APPOVAL_NODE)
  .addEdge(HUMAN_APPOVAL_NODE, EXECUTOR_NODE)
  .addEdge(EXECUTOR_NODE, END);

export const agent = workflow.compile({
  checkpointer: new MemorySaver(),
});
