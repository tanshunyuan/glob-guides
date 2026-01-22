# Single Agent - Research Assistant

A simple research agent built with LangGraph and LangChain that uses Tavily for web search to answer research questions.

## Prerequisites

- Node.js 24.12.0
- OpenAI API key
- Tavily API key

### Node Version

This project uses Node.js **24.12.0**. If you're using [mise](https://mise.jdx.dev/), the correct version will be automatically selected from `mise.toml`.

If you're not using mise, check the required version in `mise.toml`:

```bash
cat mise.toml
```

Then ensure you're running the correct Node version:

```bash
node --version
# Should output: v24.12.0
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with your API keys:

```bash
OPENAI_API_KEY=your-openai-api-key
TAVILY_API_KEY=your-tavily-api-key
```

## Running the Agent

Start the agent in watch mode (auto-reloads on file changes):

```bash
npm start
```

## How It Works

The agent uses a simple LangGraph state machine with two nodes:

1. **Researcher Node** - Processes user queries using GPT-4.1-mini with access to the Tavily search tool
2. **Tool Node** - Executes web searches when the LLM requests them

The flow:
- User provides a research question
- The researcher LLM decides if it needs to search the web
- If yes, Tavily searches are executed and results fed back to the LLM
- The LLM synthesizes a final response with sources
