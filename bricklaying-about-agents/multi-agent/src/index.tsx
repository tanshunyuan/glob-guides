import { useState, ComponentProps, Fragment } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { Tab, Tabs } from "ink-tab";
import { BaseMessage, HumanMessage, AIMessage } from "langchain";
import { HumanApprovalResponse } from "./agent/index.js";
import Spinner from "ink-spinner";
import { useMessagesContext, MessagesProvider } from "./ui/provider.js";

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
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={1}
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
    <Box flexDirection="column">
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

const MessageHistory = ({ messages }: { messages: BaseMessage[] }) => {
  if (messages.length === 0) {
    return (
      <Box flexGrow={1} flexDirection="column">
        <Text color="dim">No messages yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" gap={1}>
      {messages.map((message, index) => {
        const role = HumanMessage.isInstance(message) ? "user" : "agent";

        let label: string;
        let labelColor: ComponentProps<typeof Text>["color"];

        switch (role) {
          case "user":
            label = "user";
            labelColor = "green";
            break;
          case "agent":
          default:
            label = "agent";
            labelColor = "dim";
            break;
        }

        return (
          <Box flexDirection="row" gap={1} key={index}>
            <Text color={labelColor}>{label}</Text>
            <Text>{String(message.content)}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

const UserInteraction = () => {
  const { exit } = useApp();
  const { messages, sendMessage, uiState, interruptData } =
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
      <MessageHistory messages={messages} />
      <ExecutionProgress />

      {interruptData ? <PlanBox /> : null}
      {uiState === "running" ? (
        <Box>
          <Text color="dim">$ </Text>
          <Spinner />
        </Box>
      ) : null}
      {uiState === "idle" && interruptData === undefined ? (
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
      ) : null}

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
