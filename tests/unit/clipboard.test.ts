import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeTextToClipboard } from "../../src/utils/clipboard";

interface FakeTextarea {
  value: string;
  style: Record<string, string>;
  removed: boolean;
  setAttribute: (name: string, value: string) => void;
  focus: () => void;
  select: () => void;
  remove: () => void;
}

interface DocumentStub {
  document: Document;
  bodyChildren: FakeTextarea[];
  getCurrentTextarea: () => FakeTextarea | null;
}

function createDocumentStub(
  execCommandImpl: (command: string, textarea: FakeTextarea | null) => boolean,
): DocumentStub {
  const bodyChildren: FakeTextarea[] = [];
  let currentTextarea: FakeTextarea | null = null;

  const document = {
    body: {
      appendChild: (textarea: FakeTextarea) => {
        bodyChildren.push(textarea);
        currentTextarea = textarea;
        return textarea;
      },
    },
    createElement: (tagName: string) => {
      if (tagName !== "textarea") {
        throw new Error(`Unexpected element requested: ${tagName}`);
      }
      const textarea: FakeTextarea = {
        value: "",
        style: {},
        removed: false,
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        remove: () => {
          textarea.removed = true;
          const index = bodyChildren.indexOf(textarea);
          if (index >= 0) {
            bodyChildren.splice(index, 1);
          }
          if (currentTextarea === textarea) {
            currentTextarea = null;
          }
        },
      };
      return textarea;
    },
    execCommand: (command: string) => execCommandImpl(command, currentTextarea),
  } as unknown as Document;

  return {
    document,
    bodyChildren,
    getCurrentTextarea: () => currentTextarea,
  };
}

describe("writeTextToClipboard", () => {
  let originalNavigatorDescriptor: PropertyDescriptor | undefined;
  let originalDocumentDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  test("uses navigator.clipboard when available", async () => {
    const writes: string[] = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (text: string) => {
            writes.push(text);
          },
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: createDocumentStub(() => {
        throw new Error("document.execCommand should not be called when navigator.clipboard exists");
      }).document,
    });

    await writeTextToClipboard("copied");

    expect(writes).toEqual(["copied"]);
  });

  test("falls back to document.execCommand when navigator.clipboard is unavailable", async () => {
    const documentStub = createDocumentStub((command, textarea) => {
      expect(command).toBe("copy");
      expect(textarea?.value).toBe("fallback copy");
      return true;
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentStub.document,
    });

    await writeTextToClipboard("fallback copy");

    expect(documentStub.bodyChildren).toHaveLength(0);
    expect(documentStub.getCurrentTextarea()).toBeNull();
  });

  test("removes the temporary textarea when execCommand throws", async () => {
    const documentStub = createDocumentStub(() => {
      throw new Error("copy blocked");
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentStub.document,
    });

    await expect(writeTextToClipboard("blocked")).rejects.toThrow("copy blocked");
    expect(documentStub.bodyChildren).toHaveLength(0);
    expect(documentStub.getCurrentTextarea()).toBeNull();
  });
});
