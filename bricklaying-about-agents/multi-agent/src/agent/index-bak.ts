import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, SystemMessage, tool, humanInTheLoopMiddleware } from "langchain";
import { env } from "../../env.js";
import { z } from "zod";

const llm = new ChatOpenAI({
  model: "gpt-4.1-mini",
  // model: 'gpt-5-nano',
  apiKey: env.OPENAI_API_KEY,
  streaming: true,
});

const RESEARCHER_SYSTEM_MESSAGE = new SystemMessage(`
  You are a research assistant that helps users find and synthesize information on any topic.

  When given a research question:
  1. Use Tavily to search for relevant information (typically 2-4 searches)
  2. Synthesize findings into a clear, concise response
  3. Include source links in your answer
  4. If the question is unclear, ask for clarification before searching

  Guidelines:
  - Prioritize recent sources when timeliness matters
  - Present multiple perspectives for debated topics
  - Be transparent about conflicting information or gaps in available data
  - Keep responses focused on answering the specific question asked
  `);

const readEmailTool = tool(
  (emailId: string) => `Email content for ID: ${emailId}`,
  {
    name: "readEmailTool",
    schema: z.string(),
  },
);

const sendEmailTool = tool(
  ({
    recipient,
    subject,
    body,
  }: {
    recipient: string;
    subject: string;
    body: string;
  }) => `Email sent to ${recipient} with subject '${subject}'`,
  {
    name: "sendEmailTool",
    schema: z.object({
      recipient: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  },
);

const memory = new MemorySaver();
export const agent = createAgent({
  model: llm,
  tools: [readEmailTool, sendEmailTool],
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: {
        sendEmailTool: {
          allowedDecisions: ["approve", "edit", "reject"],
        },
        readEmailTool: false,
      },
    }),
  ],
  systemPrompt: RESEARCHER_SYSTEM_MESSAGE,
  checkpointer: memory,
});
