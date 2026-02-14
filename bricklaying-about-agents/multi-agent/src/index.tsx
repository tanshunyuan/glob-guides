import React, { useState, useEffect } from "react";
import { Box, render, Text } from "ink";
import { useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Tab, Tabs } from "ink-tab";
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  Interrupt,
  HITLResponse,
  HITLRequest,
  ToolMessage,
  trimMessages,
} from "langchain";
import { agent } from "./agent/index.js";
import { Command } from "@langchain/langgraph";

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
  const [interruptData, setInterruptData] = useState<HITLRequest | undefined>(
    undefined,
  );
  // const [input, setInput] = useState("");
  const [input, setInput] = useState(
    "can you help me find the recent feats of kilian jornet",
  );
  // const [input, setInput] = useState(
  //   "can you send out an email to jane for meme@test.com and the content is you are a meme",
  // );
  const resumeInterrupt = async (data: HITLResponse) => {
    const response = await agent.stream(
      new Command({
        resume: data,
      }),
      {
        streamMode: ["messages", "updates"],
        configurable: {
          thread_id: "1234",
        },
      },
    );

    setMessages((prev) => [...prev, new AIMessage("")]);
    for await (const chunks of response) {
      const [mode, chunk] = chunks;

      if (mode === "messages") {
        const [token, metadata] = chunk;
        // console.log(`node: ${metadata.langgraph_node}`);
        // console.log(`content: ${JSON.stringify(token.contentBlocks, null, 2)}`);
        const tokenContentBlocks = token.contentBlocks;
        if (!tokenContentBlocks.length) continue;

        // if(metadata.langgraph_node === 'tools'){
        //   setMessages((prev) => [...prev, new ToolMessage({})]);
        // }

        if (metadata.langgraph_node === "model_request") {
          for (const tokenContent of tokenContentBlocks) {
            if (tokenContent.type === "text") {
              const newContent = tokenContent.text;
              setMessages((prev) => {
                // returns a shallow copy without the last element
                const trimmedMsg = prev.slice(0, -1);
                // grabs the last item in the array, access it's content and append the new content
                const updatedContent = new AIMessage(
                  prev.slice(-1)[0]?.content + newContent,
                );
                return [...trimmedMsg, updatedContent];
              });
            }
          }
        }
      }

      if (mode === "updates") {
        if ("__interrupt__" in chunk) {
          const interruptContent = chunk[
            "__interrupt__"
          ] as unknown as Interrupt<HITLRequest>[];

          const hasInterruptInfo =
            Array.isArray(interruptContent) &&
            interruptContent[0] &&
            Object.hasOwn(interruptContent[0]?.value, "actionRequests") &&
            interruptContent[0].value.actionRequests.length > 0;

          if (hasInterruptInfo) {
            const interruptInfo = interruptContent[0]?.value;
            setInterruptData(interruptInfo);
          }
        }
      }
    }
  };

  const sendMessage = async () => {
    const userMessage = new HumanMessage(input);
    setMessages((prev) => [...prev, userMessage]);

    setInput("");

    const response = await agent.stream(
      {
        messages: [...messages, userMessage],
      },
      {
        streamMode: ["messages", "updates"],
        configurable: {
          thread_id: "1234",
        },
      },
    );

    // Add empty assistant message that we'll update
    setMessages((prev) => [...prev, new AIMessage("")]);

    for await (const chunks of response) {
      // console.log("le chunks", chunks);
      const [mode, chunk] = chunks;

      if (mode === "messages") {
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

      if (mode === "updates") {
        if ("__interrupt__" in chunk) {
          console.log("interrupt chunk ", chunk);
          const interruptContent = chunk[
            "__interrupt__"
          ] as unknown as Interrupt<HITLRequest>[];

          const hasInterruptInfo =
            Array.isArray(interruptContent) &&
            interruptContent[0] &&
            Object.hasOwn(interruptContent[0]?.value, "actionRequests") &&
            interruptContent[0].value.actionRequests.length > 0;

          if (hasInterruptInfo) {
            const interruptInfo = interruptContent[0]?.value;
            setInterruptData(interruptInfo);
          }
        }
      }
    }
  };

  return {
    messages,
    input,
    setInput,
    sendMessage,
    interruptData,
    setInterruptData,
    resumeInterrupt,
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

const HITLPrompt = ({
  interruptData,
  setInterruptData,
  resumeInterrupt,
}: {
  interruptData: HITLRequest;
  setInterruptData: (data: undefined) => void;
  resumeInterrupt: (data: HITLResponse) => Promise<void>;
}) => {
  const [activeKey, setActiveKey] = useState("accept");

  useInput((input, key) => {
    if (key.return) {
      const resume: HITLResponse = {
        decisions: [
          {
            //@ts-ignore
            type: activeKey,
          },
        ],
      };
      setInterruptData(undefined);
      resumeInterrupt(resume);
    }
  });

  return (
    <Box width="100%" flexDirection="column">
      <Text>{interruptData.actionRequests[0]?.name}</Text>
      <Text>{interruptData.actionRequests[0]?.description}</Text>
      <Tabs
        onChange={(newTabKey) => {
          setActiveKey(newTabKey);
        }}
      >
        <Tab name="approve">Approve</Tab>
        <Tab name="edit">Edit</Tab>
        <Tab name="reject">Reject</Tab>
      </Tabs>
    </Box>
  );
};

const UserInteraction = () => {
  const { exit } = useApp();
  const {
    messages,
    input,
    setInput,
    sendMessage,
    interruptData,
    setInterruptData,
    resumeInterrupt,
  } = useMessages();

  const [showShutdown, setShowShutdown] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === "q") {
      setShowShutdown(true);
      setTimeout(() => {
        exit();
      }, 500);
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
      {interruptData ? (
        <HITLPrompt
          setInterruptData={setInterruptData}
          interruptData={interruptData}
          resumeInterrupt={resumeInterrupt}
        />
      ) : (
        <Box width="100%">
          <Text color="blue">$ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            placeholder="Type a command..."
            onSubmit={sendMessage}
          />
        </Box>
      )}
      {showShutdown && (
        <Box>
          <Text color="yellow">Shutting down...</Text>
        </Box>
      )}
    </Box>
  );
};

render(<UserInteraction />);
