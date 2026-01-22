import { ChatOpenAI } from "@langchain/openai";
import { env } from "./env.js";
import { TavilySearch } from "@langchain/tavily";
import {
  Command,
  END,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
  type GraphNode,
} from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

const llm = new ChatOpenAI({
  model: "gpt-4.1-mini",
  apiKey: env.OPENAI_API_KEY,
});

const webSearchTool = new TavilySearch({
  tavilyApiKey: env.TAVILY_API_KEY,
  maxResults: 3,
});

const TOOLS_MAP = {
  [webSearchTool.name]: webSearchTool,
};
const tools = Object.values(TOOLS_MAP);

const State = new StateSchema({
  messages: MessagesValue,
});

const RESEARCHER_NODE = "researcherNode" as const;
const researcherNode: GraphNode<typeof State> = async (state) => {
  const llmWTools = llm.bindTools(tools);
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
  const response = await llmWTools.invoke([
    RESEARCHER_SYSTEM_MESSAGE,
    ...state.messages,
  ]);

  return new Command({
    update: {
      messages: [response],
    },
  });
};

const TOOL_NODE = "toolNode" as const;
const toolNode: GraphNode<typeof State> = async (state) => {
  const lastMessage = state.messages.at(-1);
  if (lastMessage === null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls ?? []) {
    const tool = TOOLS_MAP[toolCall.name];
    const observation = await tool?.invoke(toolCall);
    result.push(observation);
  }
  return new Command({
    update: {
      messages: result,
    },
  });
};

const shouldContinueRouter = (
  state: typeof State.State,
): typeof END | typeof TOOL_NODE => {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return END;
  }

  const hasToolCalls = lastMessage.tool_calls?.length;
  if (hasToolCalls) {
    return TOOL_NODE;
  }

  return END;
};

const researcherAgent = new StateGraph(State)
  .addNode(RESEARCHER_NODE, researcherNode)
  .addNode(TOOL_NODE, toolNode)
  .addEdge(START, RESEARCHER_NODE)
  .addConditionalEdges(RESEARCHER_NODE, shouldContinueRouter, [TOOL_NODE, END])
  .addEdge(TOOL_NODE, RESEARCHER_NODE)
  .compile();

const result = await researcherAgent.invoke({
  messages: [
    new HumanMessage(
      "find out about kilian jornet, and his recent achievements.",
    ),
  ],
});

for (const message of result.messages) {
  console.log(`[${message.type}]: ${message.text}`);
}

// [human]: find out about kilian jornet, and his recent achievements.
// [ai]:
// [tool]: {"query":"Kilian Jornet recent achievements 2024","follow_up_questions":null,"answer":null,"images":[],"results":[{"url":"https://www.cyclingweekly.com/news/endurance-goat-kilian-jornets-new-challenge-a-tour-de-france-stage-and-a-marathon-every-day","title":"Endurance GOAT Kilian Jornet's new challenge: a Tour de ...","content":"In 2024, Jornet completed a project he called Alpine Connections, in which he linked together 82 4,000m peaks in the European Alps by bicycle, a journey of approximately 1,200 kilometers, with 75k vertical meters over 19 days. A breakdown of this effort, published by Coros here, shows almost non-stop movement with only short breaks for eating and sleeping.\n\nIt must be said that this amount of physical output would kill an ordinary person. [...] The Spaniard has won several of the world’s most challenging ultramarathons, holds an array of FKTs (Fastest Known Times) and speed records, has multiple world titles in ski mountaineering, and has conquered many of world’s highest mountains, including, albeit somewhat controversially, Mount Everest. He has twice been named Adventurer of the Year by National Geographic, and, furthermore, is the father of three young children.\n\nCanadian cyclist Alexis Cartier rode to every start line of the Life Time Grand Prix\nCameron Jones\nMatteo Jorgenson [...] For his latest project, termed States of Elevation, Jornet will attempt to climb all the fourteeners located in the Western United States (not including Alaska). These mountains are located in Colorado, California and Washington, which, unfortunately, are not all that close to one another. Jornet will travel the entire distance between each mountain by bicycle.","score":0.9969246,"raw_content":null},{"url":"https://www.irunfar.com/kilian-jornet-completes-states-of-elevation-2025-us-mountain-project","title":"Kilian Jornet Completes U.S. \"States of Elevation\" Project","content":"Jornet, arguably the best ultrarunner of this generation, has won UTMB four times, the Hardrock 100 five times, and the Zegama Marathon 11 times. Over his","score":0.98951083,"raw_content":null},{"url":"https://www.latimes.com/california/story/2025-10-16/spanish-speed-climber-six-dozen-us-peaks-one-month","title":"72 peaks. 31 days. One mountaineering legend","content":"In addition to all of the technical mountaineering, Jornet has been one of the most successful ultramarathoners in history, winning the prestigious Ultra-Trail du Mont Blanc, a 100-mile race through the Alps, four times.\n\nAfter his early career dominating distance races in relatively cold climates, Jornet showed up at Northern California’s Western States ultramarathon in 2010. It’s a 100-mile race that starts near the shore of Lake Tahoe and descends to the Sacramento suburbs in late June, when the sun and temperatures can be unforgiving.\n\nHe was comically unprepared. “I didn’t do any heat training,” Jornet recalled, “so when I arrived I was like, ‘Should I have brought water for this race?’” Still, he came in third, then returned the next year to win. [...] # 72 peaks. 31 days. One mountaineering legend: Kilian Jornet’s mind-blowing mountain marathon\n\nSpanish mountaineer Kilian Jornet climbs Mount Rainier in Washington.\nJack Dolan.\n\nThis is read by an automated voice. Please report any issues or inconsistencies here.\n\nKilian Jornet, one of the world’s most accomplished mountaineers, did something this month that left even other elite athletes gasping: He climbed all 72 summits in the contiguous United States that stand over 14,000 feet tall.\n\nIn 31 days.\n\nThat’s like climbing California’s Mt. Whitney — the nation’s tallest mountain outside of Alaska — two-and-a-half times per day, every day, for a month. [...] But reaching so many summits, so quickly, was only half the battle. In fact, it was “the fun part,” a surprisingly rested-looking Jornet said in a Zoom interview from Seattle earlier this month, three days after summiting Mt. Rainier in knee-deep snow to complete the grueling journey, which he started in early September.\n\nThe hard part was negotiating the spaces in between.\n\nSpanish mountaineer Kilian Jornet in the Sierra Nevada range known as the Normans 13.\n\n“If you’re driving, you see the landscape,” Jornet explained. “But you don’t feel it.”\n\nOK, how do you feel it?\n\nBy running the hundreds of miles of remote mountain ridges, and biking the thousands of miles of desolate highway, that separate the towering summits scattered across Colorado, California and Washington.","score":0.677474,"raw_content":null}],"response_time":3.27,"request_id":"71eae3f2-aff8-4cad-84fc-7874002aecd6"}
// [ai]: Kilian Jornet, renowned as one of the greatest ultrarunners and mountaineers of his generation, has achieved remarkable feats recently in 2024 and into 2025. Among his recent achievements:

// 1. In 2024, he completed a project called Alpine Connections in the European Alps. He linked together 82 peaks above 4,000 meters by bicycle in about 1,200 kilometers with 75k vertical meters over 19 days. This intense endurance project involved almost non-stop movement.

// 2. Jornet embarked on a new challenge called States of Elevation, where he aimed to climb all the summits over 14,000 feet ("fourteeners") in the contiguous United States (Colorado, California, and Washington). He successfully completed climbing all 72 of these peaks in 31 days, a feat that involved intense mountaineering combined with running and biking between the peaks to feel the mountain landscapes more deeply.

// 3. His legendary status is underscored by multiple victories including four UTMB titles, five Hardrock 100 wins, and 11 wins at the Zegama Marathon, along with several Fastest Known Times and speed records in mountain and ultrarunning disciplines.

// 4. Jornet also has been acknowledged twice as Adventurer of the Year by National Geographic and is known for his mountaineering climbs on the world's highest mountains, including Mount Everest.

// In summary, his recent achievements highlight continuous pushing of endurance and mountaineering boundaries through innovative projects combining ultra-distance running, cycling, and high-altitude climbing.

// Sources:
// - https://www.cyclingweekly.com/news/endurance-goat-kilian-jornets-new-challenge-a-tour-de-france-stage-and-a-marathon-every-day
// - https://www.irunfar.com/kilian-jornet-completes-states-of-elevation-2025-us-mountain-project
// - https://www.latimes.com/california/story/2025-10-16/spanish-speed-climber-six-dozen-us-peaks-one-month
