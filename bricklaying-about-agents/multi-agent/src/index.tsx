import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
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

const MessagesContext = createContext<
  | {
      messages: BaseMessage[];
      interruptData: HITLRequest | undefined;
      sendMessage: (input: string) => Promise<void>;
      resumeInterrupt: (data: HITLResponse) => Promise<void>;
    }
  | undefined
>(undefined);

const useMessagesContext = () => {
  const context = useContext(MessagesContext);
  if (context === undefined) {
    throw new Error(
      "useMessagesContext must be used within a MessagesProvider",
    );
  }
  return context;
};

/**
 * @description component to handle the instantiation of MessagesContext.Provider
 */
const MessagesProvider = ({ children }: { children: React.ReactNode }) => {
  const [messages, setMessages] = useState<BaseMessage[]>([]);
  const [interruptData, setInterruptData] = useState<HITLRequest | undefined>();

  const sendMessage = useCallback(
    async (input: string) => {
      const userMessage = new HumanMessage(input);
      setMessages((prev) => [...prev, userMessage]);

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
    },
    [messages],
  ); // Add dependencies

  const resumeInterrupt = useCallback(async (data: HITLResponse) => {
    setInterruptData(undefined);
    const response = await agent.stream(
      new Command({
        resume: data,
      }),
      {
        streamMode: ["messages", "updates"],
        subgraphs: true,
        configurable: {
          thread_id: "1234",
        },
      },
    );

    setMessages((prev) => [...prev, new AIMessage("")]);
    for await (const chunks of response) {
      const [_, streamMode, chunk] = chunks;

      // console.log(`streamMode ==> ${streamMode}`);
      // console.log(`chunk ==> ${JSON.stringify(chunk)}`);

      if (streamMode === "messages") {
        const [token, metadata] = chunk;
        // console.log(`node: ${metadata.langgraph_node}`);
        // console.log(`content: ${JSON.stringify(token.contentBlocks, null, 2)}`);
        const tokenContentBlocks = token.contentBlocks;
        if (!tokenContentBlocks.length) continue;

        // if(metadata.langgraph_node === 'tools'){
        //   setMessages((prev) => [...prev, new ToolMessage({})]);
        // }

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

      if (streamMode === "updates") {
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
  }, []);

  return (
    <MessagesContext.Provider
      value={{ messages, interruptData, sendMessage, resumeInterrupt }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

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

const HITLPrompt = () => {
  const { interruptData, resumeInterrupt } = useMessagesContext();
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
      resumeInterrupt(resume);
    }
  });

  if (!interruptData) return;

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
  const { messages, sendMessage, interruptData, resumeInterrupt } =
    useMessagesContext();

  const [input, setInput] = useState("");
  // const [input, setInput] = useState(
  //   "can you help me find the recent feats of kilian jornet",
  // );

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
        <HITLPrompt />
      ) : (
        <Box width="100%">
          <Text color="blue">$ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            placeholder="Type a command..."
            onSubmit={() => {
              sendMessage(input);
              setInput("");
            }}
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

render(
  <MessagesProvider>
    <UserInteraction />
  </MessagesProvider>,
  {
    // patchConsole: false,
  },
);
