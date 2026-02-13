import React, { useState, useEffect } from "react";
import { Box, render, Text } from "ink";
import { useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { BaseMessage, HumanMessage, AIMessage } from "langchain";
import { agent } from "./agent/index.js";

const BlinkingDot = ({ color = "green" }: { color: string }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return <Text color={color}>{visible ? "●" : " "}</Text>;
};

const useMessages = () => {
  const [messages, setMessages] = useState<BaseMessage[]>([]);
  const [input, setInput] = useState("");

  const sendMessage = async () => {
    const userMessage = new HumanMessage(input);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    const response = await agent.stream(
      {
        messages: [...messages, userMessage],
      },
      {
        streamMode: "messages",
        configurable: {
          thread_id: "1234",
        },
      },
    );

    // Add empty assistant message that we'll update
    setMessages((prev) => [...prev, new AIMessage("")]);

    for await (const chunk of response) {
      const [token, metadata] = chunk;
      // console.log(`node: ${metadata.langgraph_node}`);
      // console.log(`content: ${JSON.stringify(token.contentBlocks, null, 2)}`);
      const tokenContentBlocks = token.contentBlocks;
      if (!tokenContentBlocks.length) continue;

      for (const tokenContent of tokenContentBlocks) {
        if (tokenContent.type === "text") {
          const newContent = tokenContent.text;
          setMessages((prev) => [
            // this removes the empty text set
            ...prev.slice(0, -1),
            // grabs the last item in the array, access it's content and append the new content
            new AIMessage(prev.slice(-1)[0]?.content + newContent),
          ]);
        }
      }
    }
  };

  return {
    messages,
    input,
    setInput,
    sendMessage,
  };
};

const Message = ({ message }: { message: BaseMessage }) => {
  if (HumanMessage.isInstance(message)) {
    return (
      <Box marginLeft={2}>
        <Text color="yellow">&gt; {message.content as string}</Text>
      </Box>
    );
  }

  if (AIMessage.isInstance(message) && message.content === "") {
    return (
      <Box marginLeft={2}>
        <BlinkingDot color="green" />
      </Box>
    );
  }

  if (typeof message.content !== "string") {
    return (
      <Box marginLeft={2}>
        <Text color="green">● {JSON.stringify(message.content, null, 2)}</Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text color="green">● {message.content}</Text>
    </Box>
  );
};

const UserInteraction = () => {
  const { exit } = useApp();
  const { messages, input, setInput, sendMessage } = useMessages();

  const [showShutdown, setShowShutdown] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === "q") {
      setShowShutdown(true);
      setTimeout(() => {
        exit();
      }, 500);
    }
    if (key.return) {
      sendMessage();
    }
  });
  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" gap={1}>
        {messages.map((message, index) => (
          <Message key={index} message={message} />
        ))}
        {messages.length > 0 && <Box flexGrow={1} />}
      </Box>
      <Box width="100%">
        <Text color="blue">$ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          placeholder="Type a command..."
        />
      </Box>
      {showShutdown && (
        <Box>
          <Text color="yellow">Shutting down...</Text>
        </Box>
      )}
    </Box>
  );
};

render(<UserInteraction />);
