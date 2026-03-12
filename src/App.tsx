/**
 * Main App component with client-side routing.
 * Manages navigation between Dashboard and LoopDetails views.
 */

import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { LoopDetails } from "./components/LoopDetails";
import { LogLevelInitializer } from "./components/LogLevelInitializer";
import { SshSessionDetails } from "./components/SshSessionDetails";
import "./index.css";

type Route =
  | { view: "dashboard" }
  | { view: "loop"; loopId: string }
  | { view: "chat"; chatId: string }
  | { view: "ssh"; sshSessionId: string };

/**
 * Parse the current URL hash into a route.
 */
function parseHash(): Route {
  const hash = window.location.hash.slice(1); // Remove #
  
  if (hash.startsWith("/loop/")) {
    const loopId = hash.slice(6); // Remove /loop/
    if (loopId) {
      return { view: "loop", loopId };
    }
  }

  if (hash.startsWith("/chat/")) {
    const chatId = hash.slice(6); // Remove /chat/
    if (chatId) {
      return { view: "chat", chatId };
    }
  }

  if (hash.startsWith("/ssh/")) {
    const sshSessionId = hash.slice(5);
    if (sshSessionId) {
      return { view: "ssh", sshSessionId };
    }
  }
  
  return { view: "dashboard" };
}

/**
 * Navigate to a route by updating the hash.
 */
function navigateTo(route: Route) {
  if (route.view === "dashboard") {
    window.location.hash = "/";
  } else if (route.view === "loop") {
    window.location.hash = `/loop/${route.loopId}`;
  } else if (route.view === "ssh") {
    window.location.hash = `/ssh/${route.sshSessionId}`;
  } else {
    window.location.hash = `/chat/${route.chatId}`;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  // Handle hash changes
  useEffect(() => {
    function handleHashChange() {
      setRoute(parseHash());
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Navigation handlers
  const handleSelectLoop = useCallback((loopId: string) => {
    navigateTo({ view: "loop", loopId });
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    navigateTo({ view: "chat", chatId });
  }, []);

  const handleBack = useCallback(() => {
    navigateTo({ view: "dashboard" });
  }, []);

  const handleSelectSshSession = useCallback((sshSessionId: string) => {
    navigateTo({ view: "ssh", sshSessionId });
  }, []);

  // Render the current view
  if (route.view === "loop") {
    return (
      <LogLevelInitializer>
        <LoopDetails
          loopId={route.loopId}
          onBack={handleBack}
          onSelectSshSession={handleSelectSshSession}
        />
      </LogLevelInitializer>
    );
  }

  if (route.view === "chat") {
    return (
      <LogLevelInitializer>
        <LoopDetails
          loopId={route.chatId}
          onBack={handleBack}
          onSelectSshSession={handleSelectSshSession}
        />
      </LogLevelInitializer>
    );
  }

  if (route.view === "ssh") {
    return (
      <LogLevelInitializer>
        <SshSessionDetails
          sshSessionId={route.sshSessionId}
          onBack={handleBack}
        />
      </LogLevelInitializer>
    );
  }

  return (
    <LogLevelInitializer>
      <Dashboard
        onSelectLoop={handleSelectLoop}
        onSelectChat={handleSelectChat}
        onSelectSshSession={handleSelectSshSession}
      />
    </LogLevelInitializer>
  );
}

export default App;
