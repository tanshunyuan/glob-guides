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
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import z from "zod";

const overallState = new StateSchema({
  messages: MessagesValue,
  objective: z.string(),
  plan: z.array(z.string()),
  rawResults: z.record(
    z.string(),
    z.custom<AIMessage>((val) => val instanceof AIMessage),
  ),
  feedback: z.string().optional(),
  result: z.string(),
});
type OverallState = typeof overallState;

const CONVERSATION_NODE = "conversationNode";
const conversationNode: GraphNode<OverallState> = async (state, config) => {
  const schema = z.object({
    is_clear: z
      .boolean()
      .describe(
        "True only if the user's message contains a specific, actionable task. False if vague, incomplete, or ambiguous.",
      ),
    objective: z
      .string()
      .nullable()
      .describe(
        "A concise restatement of the user's goal. Only populated when is_clear is true. Null otherwise.",
      ),
    followup: z
      .string()
      .nullable()
      .describe(
        "A single clarifying question to resolve ambiguity. Only populated when is_clear is false. Null otherwise.",
      ),
  });

  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
  }).withStructuredOutput(schema);

  const systemPrompt = new SystemMessage(`
    You are an intent classifier for an AI agent pipeline.

    Given the conversation history, determine if the user has expressed a clear,
    actionable objective.

    Rules:
    - is_clear = true ONLY if you can extract a specific, self-contained task
    - is_clear = false if the request is vague, incomplete, or requires assumptions
    - If is_clear = true: populate 'objective' with a concise restatement of the
      user's goal. Set  'followup' to null.
    - If is_clear = false: populate 'followup' with a single, specific clarifying
      question. Set 'objective' to null.

    Examples of CLEAR: "Summarize this PDF", "Write a SQL query to find top 10 customers"
    Examples of VAGUE: "Help me with my project", "Do something with this data"
  `);
  const response = await model.invoke([systemPrompt, ...state.messages]);

  if (!response.is_clear && response.followup) {
    return new Command({
      update: {
        messages: [new AIMessage(response.followup)],
      },
      goto: END,
    });
  } else {
    return new Command({
      update: {
        objective: response.objective!,
      },
      goto: PLANNER_NODE,
    });
  }
};

const PLANNER_NODE = "plannerNode";
const plannerNode: GraphNode<OverallState> = async (state, config) => {
  const schema = z.object({
    plan: z.array(z.string()),
  });
  const model = new ChatOpenAI({
    model: "gpt-4.1-mini",
    apiKey: env.OPENAI_API_KEY,
    streaming: true,
  }).withStructuredOutput(schema);

  let systemPrompt;
  if (!state.feedback) {
    systemPrompt = new SystemMessage(`
      your goal is to come up with a plan based on the following objective:

      objective: ${state.objective}

      limit yourself to one plans
      `);
  } else {
    /**@todo shift feedback handling to user message, doesn't feel right to be here */
    systemPrompt = new SystemMessage(`
      your goal is to come up with a plan based on the following objective:

      objective: ${state.objective}

      the user had given this feedback: ${state.feedback}

      this was the original plan: ${state.plan.join("\n")}
      `);
  }
  const response = await model.invoke([systemPrompt, ...state.messages]);

  return new Command({
    update: {
      plan: response.plan,
      feedback: undefined,
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
  content: string[];
  actions: HumanApprovalResponse[];
};
const HUMAN_APPOVAL_NODE = "humanApprovalNode";
const humanApprovalNode: GraphNode<OverallState> = async (
  state,
): Promise<Command<OverallState>> => {
  console.log("at humanApprovalNode");
  console.log("humanApprovalNode.state ==> ", JSON.stringify(state));
  const interruptRequest: HumanApprovalRequest = {
    name: "Plan Review",
    description: "Review the plan suggested by the planner",
    content: state.plan,
    actions: [{ type: "accept" }, { type: "cancel", feedback: undefined }],
  };

  const response: HumanApprovalResponse = interrupt(interruptRequest);
  if (response.type === "accept") {
    return new Command({
      goto: EXECUTOR_NODE,
    });
  } else if (response.type === "cancel") {
    return new Command({
      goto: PLANNER_NODE,
      update: {
        // messages: [
        //   ...state.messages,
        //   new HumanMessage(
        //     response.feedback
        //       ? `The user rejected the plan. Feedback: ${response.feedback}`
        //       : "The user rejected the plan.",
        //   ),
        // ],
        feedback: response.feedback
          ? `The user rejected the plan. Feedback: ${response.feedback}`
          : "The user rejected the plan.",
      },
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
    dispatchCustomEvent("task_start", { task });
    const response = await researcherAgent.invoke({
      task,
    });
    result[task] = response.result;
    dispatchCustomEvent("task_done", { task });
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
    ends: [EXECUTOR_NODE, PLANNER_NODE, END],
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
/**@description researcher sub agent */
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
