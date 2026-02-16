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
import { SystemMessage, HumanMessage, AIMessage } from "langchain";
import z from "zod";

const overallState = new StateSchema({
  messages: MessagesValue,
  objective: z.string(),
  plan: z.array(z.string()),
  rawResults: z.record(
    z.string(),
    z.custom<AIMessage>((val) => val instanceof AIMessage),
  ),
  result: z.string(),
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

    limit yourself to one plans
    `);
  const response = await model.invoke([systemPrompt, ...state.messages]);

  return new Command({
    update: {
      plan: response.parsed.plan,
    },
    goto: HUMAN_APPOVAL_NODE,
  });
};

export type HumanApprovalResponse =
  | {
      type: "accept";
    }
  | {
      type: "cancel";
      feedback: string | undefined;
    };

export type HumanApprovalRequest = {
  name: string;
  description: string;
  content: string;
  actions: HumanApprovalResponse[];
};
const HUMAN_APPOVAL_NODE = "humanApprovalNode";
const humanApprovalNode: GraphNode<OverallState> = async (
  state,
): Promise<Command<OverallState>> => {
  console.log("at humanApprovalNode");
  const interruptRequest: HumanApprovalRequest = {
    name: "Plan Review",
    description: "Review the plan suggested by the planner",
    content: state.plan.join(`\n`),
    actions: [{ type: "accept" }, { type: "cancel", feedback: undefined }],
  };

  const response: HumanApprovalResponse = interrupt(interruptRequest);
  console.log("humanApprovalNode.response ==> ", response);
  if (response.type === "accept") {
    return new Command({
      goto: EXECUTOR_NODE,
    });
  } else if (response.type === "cancel") {
    return new Command({
      goto: END,
      update: {
        messages: [...state.messages, new HumanMessage('The user rejected the plan')]
      }
    });
  }

  return new Command({
    goto: END,
  });
};

const EXECUTOR_NODE = "executorNode";
const executorNode: GraphNode<OverallState> = async (state, config) => {
  console.log("at executorNode");
  const result: Record<string, AIMessage> = {};
  for (const task of state.plan) {
    console.log(`searching on ${task}`);
    const response = await researcherAgent.invoke({
      task,
    });
    result[task] = response.result;
  }
  return new Command({
    update: {
      rawResults: result,
    },
  });
};

const SUMMARISE_NODE = "summariseNode";
const summariseNode: GraphNode<OverallState> = async (state, config) => {
  console.log("at summariseNode");
  const allRawResults = Object.values(state.rawResults);
  const allResults = allRawResults.map((item) => item.content);
  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
    streaming: true,
  });
  const systemPrompt = new SystemMessage(`
    you are a synthesizer, you take in all this information and respond with the final thing
    `);
  const response = await model.invoke([
    systemPrompt,
    new HumanMessage(allResults.join("\n")),
  ]);

  return new Command({
    update: {
      result: response.text,
    },
  });
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
  .addNode(SUMMARISE_NODE, summariseNode)
  .addEdge(START, CONVERSATION_NODE)
  .addEdge(PLANNER_NODE, HUMAN_APPOVAL_NODE)
  .addEdge(EXECUTOR_NODE, SUMMARISE_NODE)
  .addEdge(SUMMARISE_NODE, END);

export const agent = workflow.compile({
  checkpointer: new MemorySaver(),
});

const researcherState = new StateSchema({
  messages: MessagesValue,
  task: z.string(),
  result: z.custom<AIMessage>((val) => val instanceof AIMessage),
});
const researcherAgent = new StateGraph(researcherState)
  .addNode("researcherNode", async (state) => {
    const model = new ChatOpenAI({
      model: "gpt-4.1-mini",
      apiKey: env.OPENAI_API_KEY,
      streaming: true,
    });
    const RESEARCHER_SYSTEM_MESSAGE = new SystemMessage(`
      You are a research assistant that helps users find and synthesize information on any topic.

      When given a research question:
      1. Synthesize findings into a clear, concise response
      2. Include source links in your answer

      Guidelines:
      - Prioritize recent sources when timeliness matters
      - Present multiple perspectives for debated topics
      - Be transparent about conflicting information or gaps in available data
      - Keep responses focused on answering the specific question asked
      `);

    const response = await model.invoke([
      RESEARCHER_SYSTEM_MESSAGE,
      new HumanMessage(state.task),
    ]);

    return new Command({
      update: {
        result: response,
      },
    });
  })
  // .addNode('tool')
  .addEdge(START, "researcherNode")
  .addEdge("researcherNode", END)
  .compile();
