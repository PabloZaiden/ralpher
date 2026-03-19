import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { CreateChatRequest, CreateLoopRequest } from "../../types";
import type { CreateLoopResult, CreateChatResult } from "../../hooks/useLoops";
import type { UseDashboardDataResult } from "../../hooks/useDashboardData";
import type { ToastContextValue } from "../../hooks/useToast";
import type { ComposeKind, ShellRoute } from "./shell-types";
import type { CreateLoopFormActionState, CreateLoopFormSubmitRequest } from "../CreateLoopForm";

export interface UseComposeStateResult {
  composeActionState: CreateLoopFormActionState | null;
  setComposeActionState: Dispatch<SetStateAction<CreateLoopFormActionState | null>>;
  handleLoopSubmit: (
    kind: Extract<ComposeKind, "loop" | "chat">,
    request: CreateLoopFormSubmitRequest,
  ) => Promise<boolean>;
}

interface UseComposeStateOptions {
  route: ShellRoute;
  createLoop: (req: CreateLoopRequest) => Promise<CreateLoopResult>;
  createChat: (req: CreateChatRequest) => Promise<CreateChatResult>;
  refreshLoops: () => Promise<void>;
  navigateWithinShell: (route: ShellRoute) => void;
  dashboardData: UseDashboardDataResult;
  toast: ToastContextValue;
}

export function useComposeState({
  route,
  createLoop,
  createChat,
  refreshLoops,
  navigateWithinShell,
  dashboardData,
  toast,
}: UseComposeStateOptions): UseComposeStateResult {
  const [composeActionState, setComposeActionState] = useState<CreateLoopFormActionState | null>(null);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      dashboardData.resetCreateModalState();
    }
  }, [dashboardData.resetCreateModalState, route]);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      setComposeActionState(null);
    }
  }, [route.view, route.view === "compose" ? route.kind : undefined]);

  async function handleLoopSubmit(
    kind: Extract<ComposeKind, "loop" | "chat">,
    request: CreateLoopFormSubmitRequest,
  ): Promise<boolean> {
    const result =
      kind === "chat"
        ? await createChat(request as CreateChatRequest)
        : await createLoop(request as CreateLoopRequest);

    if (result.startError) {
      toast.error("Uncommitted changes blocked the new run. Resolve them and try again.");
      return false;
    }

    if (!result.loop) {
      toast.error(kind === "chat" ? "Failed to create chat" : "Failed to create loop");
      return false;
    }

    await refreshLoops();
    navigateWithinShell(
      kind === "chat"
        ? { view: "chat", chatId: result.loop.config.id }
        : { view: "loop", loopId: result.loop.config.id },
    );
    return true;
  }

  return {
    composeActionState,
    setComposeActionState,
    handleLoopSubmit,
  };
}
