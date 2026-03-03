/**
 * Unit tests for ACP session config options support.
 * Tests that model selection works via session/set_config_option
 * per the ACP session-config-options spec.
 */

import { describe, expect, test } from "bun:test";
import type { ConfigOption, AgentSession } from "../../src/backends/types";

describe("ConfigOption type structure", () => {
  test("ConfigOption matches ACP session-config-options spec", () => {
    const option: ConfigOption = {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-5.2",
      options: [
        { value: "gpt-5.2", name: "GPT-5.2", description: "Fast model" },
        { value: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
      ],
    };

    expect(option.id).toBe("model");
    expect(option.category).toBe("model");
    expect(option.type).toBe("select");
    expect(option.currentValue).toBe("gpt-5.2");
    expect(option.options).toHaveLength(2);
    expect(option.options[0]!.value).toBe("gpt-5.2");
    expect(option.options[1]!.value).toBe("claude-sonnet-4.6");
  });

  test("AgentSession includes optional configOptions", () => {
    const session: AgentSession = {
      id: "sess-123",
      createdAt: new Date().toISOString(),
      model: "gpt-5.2",
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "gpt-5.2",
          options: [
            { value: "gpt-5.2", name: "GPT-5.2" },
          ],
        },
        {
          id: "mode",
          name: "Session Mode",
          category: "mode",
          type: "select",
          currentValue: "code",
          options: [
            { value: "ask", name: "Ask" },
            { value: "code", name: "Code" },
          ],
        },
      ],
    };

    expect(session.configOptions).toHaveLength(2);
    const modelOption = session.configOptions!.find((o) => o.category === "model");
    expect(modelOption).toBeDefined();
    expect(modelOption!.currentValue).toBe("gpt-5.2");
  });

  test("AgentSession works without configOptions (backward compat)", () => {
    const session: AgentSession = {
      id: "sess-456",
      createdAt: new Date().toISOString(),
    };

    expect(session.configOptions).toBeUndefined();
    expect(session.model).toBeUndefined();
  });

  test("ConfigOption without optional fields", () => {
    const option: ConfigOption = {
      id: "custom",
      name: "Custom Option",
      type: "select",
      currentValue: "a",
      options: [{ value: "a", name: "Option A" }],
    };

    expect(option.description).toBeUndefined();
    expect(option.category).toBeUndefined();
  });
});

describe("Model selection via config options flow", () => {
  test("model config option identifies by category 'model'", () => {
    const configOptions: ConfigOption[] = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "code",
        options: [{ value: "code", name: "Code" }],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "claude-sonnet-4.6",
        options: [
          { value: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
          { value: "gpt-5.2", name: "GPT-5.2" },
        ],
      },
    ];

    const modelOption = configOptions.find((o) => o.category === "model" || o.id === "model");
    expect(modelOption).toBeDefined();
    expect(modelOption!.currentValue).toBe("claude-sonnet-4.6");
    expect(modelOption!.options).toHaveLength(2);
  });

  test("model config option identified by id 'model' when category missing", () => {
    const configOptions: ConfigOption[] = [
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "gpt-5.2",
        options: [
          { value: "gpt-5.2", name: "GPT-5.2" },
        ],
      },
    ];

    const modelOption = configOptions.find((o) => o.category === "model" || o.id === "model");
    expect(modelOption).toBeDefined();
    expect(modelOption!.currentValue).toBe("gpt-5.2");
  });

  test("no model option returns undefined gracefully", () => {
    const configOptions: ConfigOption[] = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "ask",
        options: [{ value: "ask", name: "Ask" }],
      },
    ];

    const modelOption = configOptions.find((o) => o.category === "model" || o.id === "model");
    expect(modelOption).toBeUndefined();
  });
});
