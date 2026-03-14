import { describe, expect, mock, test } from "bun:test";

import { CreateSshServerModal } from "@/components/CreateSshServerModal";
import { renderWithUser } from "../helpers/render";

describe("CreateSshServerModal", () => {
  test("disables password autofill and password manager prompts", async () => {
    const { getByLabelText } = renderWithUser(
      <CreateSshServerModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={mock(async () => null)}
      />,
    );

    const passwordInput = getByLabelText(/Browser-only password/) as HTMLInputElement;
    expect(passwordInput.autocomplete).toBe("off");
    expect(passwordInput.getAttribute("autocapitalize")).toBe("off");
    expect(passwordInput.getAttribute("autocorrect")).toBe("off");
    expect(passwordInput.getAttribute("data-1p-ignore")).toBe("true");
    expect(passwordInput.getAttribute("data-bwignore")).toBe("true");
    expect(passwordInput.getAttribute("data-form-type")).toBe("other");
    expect(passwordInput.getAttribute("data-lpignore")).toBe("true");
    expect(passwordInput.getAttribute("spellcheck")).toBe("false");
  });
});
