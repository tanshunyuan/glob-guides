import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
  ComponentProps,
} from "react";
import { Box, render, Text } from "ink";
import { useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Tab, Tabs } from "ink-tab";
import { BaseMessage, HumanMessage, AIMessage, Interrupt } from "langchain";
import {
  agent,
  HumanApprovalRequest,
  HumanApprovalResponse,
} from "./agent/index.js";
import { Command } from "@langchain/langgraph";
import Spinner from "ink-spinner";
import { StreamEvent } from "@langchain/core/tracers/log_stream";
import { IterableReadableStream } from "@langchain/core/utils/stream";

const MessagesContext = createContext<
  | {
      messages: BaseMessage[];
      interruptData: HumanApprovalRequest | undefined;
      planOrder: string[];
      taskStatuses: Record<string, "pending" | "running" | "done">;
      sendMessage: (input: string) => Promise<void>;
      resumeInterrupt: (data: HumanApprovalResponse) => Promise<void>;
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
  const [interruptData, setInterruptData] = useState<
    HumanApprovalRequest | undefined
  >(undefined);
  const [planOrder, setPlanOrder] = useState<string[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, "pending" | "running" | "done">
  >({});

  const handleStreamEvents = async (
    rawStreamEvent: IterableReadableStream<StreamEvent>,
  ) => {
    for await (const rawEvent of rawStreamEvent) {
      // console.log("le rawEvent", rawEvent);
      const eventName = rawEvent.event;
      const eventData = rawEvent.data;
      const nodeName = rawEvent.metadata.langgraph_node;

      if (eventName === "on_parser_end") {
        let newContent = undefined;
        const parsedOutput = eventData.output;
        switch (nodeName) {
          case "conversationNode":
            const conversationOutput = parsedOutput as {
              followup: string | null;
              objective: string | null;
            };
            newContent =
              conversationOutput.followup ??
              `Got it, coming up with a plan for: ${conversationOutput.objective}`;
            break;
          case "plannerNode":
            const plannerOutput = parsedOutput as { plan: string[] };
            // newContent = plannerOutput.plan
            //   .map((item, i) => `${i + 1}. ${item}`)
            //   .join("\n");
            break;
        }
        if (newContent === undefined) continue;
        setMessages((prev) => [
          // this removes the empty text set
          ...prev.slice(0, -1),
          // grabs the last item in the array, access it's content and append the new content
          new AIMessage(prev.slice(-1)[0]?.content + newContent + "\n\n"),
        ]);
      }

      if (eventName === "on_chain_stream" && eventData.chunk?.__interrupt__) {
        const interruptContent = eventData.chunk?.__interrupt__;
        const hasInterruptInfo =
          Array.isArray(interruptContent) && interruptContent[0];

        if (hasInterruptInfo) {
          const interruptInfo = interruptContent[0]?.value;
          setInterruptData(interruptInfo);
          setPlanOrder(interruptInfo.content);
        }
      }

      if (
        eventName === "on_chat_model_stream" &&
        nodeName === "summariseNode"
      ) {
        const chunk = eventData.chunk?.content;
        const token = typeof chunk === "string" ? chunk : "";
        if (!token) continue;

        setMessages((prev) => {
          const last = prev.at(-1);
          if (last && AIMessage.isInstance(last)) {
            return [
              ...prev.slice(0, -1),
              new AIMessage(String(last.content) + token),
            ];
          }
          return [...prev, new AIMessage(token)];
        });
      }

      if (eventName === "on_custom_event") {
        const customEventName = rawEvent.name;
        const customEventData = rawEvent.data;
        if (customEventName === "task_start") {
          setTaskStatuses((prev) => ({
            ...prev,
            [customEventData.task]: "running",
          }));
        }
        if (customEventName === "task_done") {
          setTaskStatuses((prev) => ({
            ...prev,
            [customEventData.task]: "done",
          }));
        }
      }
    }
  };

  const sendMessage = useCallback(
    async (input: string) => {
      const userMessage = new HumanMessage(input);
      setMessages((prev) => [...prev, userMessage]);

      const response = agent.streamEvents(
        {
          messages: [...messages, userMessage],
        },
        {
          configurable: {
            thread_id: "1234",
          },
          version: "v2",
        },
      );

      // Add empty assistant message that we'll update
      setMessages((prev) => [...prev, new AIMessage("")]);

      await handleStreamEvents(response);
    },
    [messages],
  );
  const resumeInterrupt = useCallback(async (data: HumanApprovalResponse) => {
    setInterruptData(undefined);

    if (data.type === "cancel") {
      setTaskStatuses({});
    }

    const response = agent.streamEvents(
      new Command({
        resume: data,
      }),
      {
        version: "v2",
        configurable: {
          thread_id: "1234",
        },
      },
    );

    // setMessages((prev) => [...prev, new AIMessage("")]);
    await handleStreamEvents(response);
  }, []);

  return (
    <MessagesContext.Provider
      value={{
        planOrder,
        messages,
        interruptData,
        sendMessage,
        resumeInterrupt,
        taskStatuses,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

const LABEL_WIDTH = 7; // "agent  " / "user   "

const Row = ({
  label,
  labelColor,
  content,
}: {
  label: string;
  labelColor: ComponentProps<typeof Text>["color"];
  content: string;
}) => {
  const lines = content.split("\n");

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={labelColor}>
            {i === 0 ? label.padEnd(LABEL_WIDTH) : " ".repeat(LABEL_WIDTH)}
          </Text>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};

const Message = ({ message }: { message: BaseMessage }) => {
  if (HumanMessage.isInstance(message)) {
    return (
      <Row
        label="user"
        labelColor="green"
        content={message.content as string}
      />
    );
  }

  const content = message.content as string;

  if (AIMessage.isInstance(message) && content === "") {
    return (
      <Box>
        <Spinner />
      </Box>
    );
  }

  return <Row label="agent" labelColor="dim" content={content} />;
};

/**@description review the plan provided by the interrupts */
const PlanBox = () => {
  const { interruptData, resumeInterrupt } = useMessagesContext();
  // set initial descision from the server
  const [decision, setDecision] = useState<HumanApprovalResponse["type"]>(
    interruptData?.actions[0]?.type || "accept",
  );
  /**@description user can choose to provide feedback or not */
  const [planFeedback, setPlanFeedback] = useState<string | undefined>(
    undefined,
  );

  useInput((input, key) => {
    if (key.return) {
      const resume: HumanApprovalResponse = {
        type: decision,
        feedback: planFeedback ? planFeedback.trim() : undefined,
      };
      resumeInterrupt(resume);
    }
  });

  if (!interruptData) return null;

  // Capitalize first letter for display
  const capitalize = (str: string) =>
    str.charAt(0).toUpperCase() + str.slice(1);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text color="dim" dimColor>
        plan review
      </Text>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {interruptData.content.map((item, i) => (
          <Box key={i} flexDirection="row" gap={1}>
            <Text color="dim">{`${i + 1}.`.padEnd(3)}</Text>
            <Text>{item}</Text>
          </Box>
        ))}
      </Box>
      <Tabs
        onChange={(newTabKey) => {
          setDecision(newTabKey as HumanApprovalResponse["type"]);
          setPlanFeedback("");
        }}
      >
        {interruptData.actions.map((decisionType, index) => (
          <Tab key={index} name={decisionType.type}>
            {capitalize(decisionType.type)}
          </Tab>
        ))}
      </Tabs>
      {decision === "cancel" && (
        <Box marginTop={1}>
          <Text color="dim">feedback: </Text>
          <TextInput
            value={planFeedback ?? ""}
            onChange={setPlanFeedback}
            placeholder="Why are you rejecting this plan?"
          />
        </Box>
      )}
    </Box>
  );
};

const ExecutionProgress = () => {
  const { taskStatuses, planOrder } = useMessagesContext();

  if (planOrder.length === 0 || Object.keys(taskStatuses).length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginLeft={LABEL_WIDTH} marginY={1}>
      {planOrder.map((task) => {
        const status = taskStatuses[task] ?? "pending";
        return (
          <Box key={task} flexDirection="row" gap={2}>
            {status === "done" && <Text color="green">✓</Text>}
            {status === "running" && <Spinner />}
            {status === "pending" && <Text color="dim">○</Text>}
            <Text color={status === "pending" ? "dim" : undefined}>{task}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

const UserInteraction = () => {
  const { exit } = useApp();
  const { messages, sendMessage, interruptData, taskStatuses } =
    useMessagesContext();

  // const [input, setInput] = useState("");
  const [input, setInput] = useState(
    "can you help me find the recent feats of kilian jornet",
  );
  // const [input, setInput] = useState("hi");

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
      {/* Message history */}
      <Box flexGrow={1} flexDirection="column" gap={1}>
        {messages.map((message, index) => (
          <Message key={index} message={message} />
        ))}
      </Box>

      {Object.keys(taskStatuses).length > 0 && (
        <Box marginLeft={LABEL_WIDTH} marginY={1} flexDirection="column">
          <Text color="dim">execution</Text>
          <ExecutionProgress />
        </Box>
      )}
      <PlanBox />
      {!interruptData && (
        <Box width="100%">
          <Text color="blue">$ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            placeholder="What would you like me to research?"
            onSubmit={() => {
              if (!input.trim()) return;
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
