import { AIMessage, BaseMessage, HumanMessage } from "langchain";
import { useContext, createContext, useState, useCallback } from "react";
import {
  agent,
  HumanApprovalRequest,
  HumanApprovalResponse,
} from "../agent/index.js";
import { StreamEvent } from "@langchain/core/tracers/log_stream";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { Command } from "@langchain/langgraph";

type MessagesContextProps = {
  messages: BaseMessage[];
  uiState: "idle" | "running";
  interruptData: HumanApprovalRequest | undefined;
  planOrder: string[];
  taskStatuses: Record<string, "pending" | "running" | "done">;
  sendMessage: (input: string) => Promise<void>;
  resumeInterrupt: (data: HumanApprovalResponse) => Promise<void>;
};

const MessagesContext = createContext<MessagesContextProps | undefined>(
  undefined,
);

export const useMessagesContext = () => {
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
export const MessagesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [messages, setMessages] = useState<BaseMessage[]>([]);
  const [interruptData, setInterruptData] = useState<
    HumanApprovalRequest | undefined
  >(undefined);
  const [planOrder, setPlanOrder] = useState<string[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<
    MessagesContextProps["taskStatuses"]
  >({});
  const [uiState, setUiState] =
    useState<MessagesContextProps["uiState"]>("idle");

  let hasStartedSummaryMessage = false;

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
        }
        if (newContent === undefined) continue;
        setMessages((prev) => [...prev, new AIMessage(newContent)]);
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
        setPlanOrder([]);
        const chunk = eventData.chunk?.content;
        const token = typeof chunk === "string" ? chunk : "";
        if (!token) continue;

        setMessages((prev) => {
          if (!hasStartedSummaryMessage) {
            hasStartedSummaryMessage = true;
            return [...prev, new AIMessage(token)];
          }

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
            //@ts-ignore
            [customEventData.task]: "running",
          }));
        }
        if (customEventName === "task_done") {
          setTaskStatuses((prev) => ({
            ...prev,
            //@ts-ignore
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

      setUiState("running");
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
      // setMessages((prev) => [...prev, new AIMessage("")]);

      await handleStreamEvents(response);
      setUiState("idle");
    },
    [messages],
  );
  const resumeInterrupt = useCallback(async (data: HumanApprovalResponse) => {
    setInterruptData(undefined);
    setUiState("running");

    if (data.type === "accept") {
      setMessages((prev) => [
        ...prev,
        new AIMessage("User accepted the plan!"),
      ]);
    }
    if (data.type === "cancel") {
      setMessages((prev) => [
        ...prev,
        !data.feedback
          ? new AIMessage("User rejected the plan :(")
          : new AIMessage(
              `User rejected the plan with this feedback: ${data.feedback}`,
            ),
      ]);
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
    setUiState("idle");
  }, []);

  return (
    <MessagesContext.Provider
      value={{
        uiState,
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
