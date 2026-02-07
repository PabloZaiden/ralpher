// Augment Bun's test Matchers with jest-dom matchers.
// This file must remain a script (no imports/exports at the top level)
// so that the `declare module` augmentation applies globally.

declare module "bun:test" {
  interface Matchers<T = unknown> {
    toBeInTheDocument(): void;
    toBeVisible(): void;
    toBeDisabled(): void;
    toBeEnabled(): void;
    toBeChecked(): void;
    toBeRequired(): void;
    toBeEmpty(): void;
    toBeEmptyDOMElement(): void;
    toBeInvalid(): void;
    toBeValid(): void;
    toContainElement(element: HTMLElement | SVGElement | null): void;
    toContainHTML(htmlText: string): void;
    toHaveAccessibleDescription(description?: string | RegExp): void;
    toHaveAccessibleErrorMessage(message?: string | RegExp): void;
    toHaveAccessibleName(name?: string | RegExp): void;
    toHaveAttribute(attr: string, value?: unknown): void;
    toHaveClass(...classNames: string[]): void;
    toHaveDescription(description?: string | RegExp): void;
    toHaveDisplayValue(value: string | RegExp | Array<string | RegExp>): void;
    toHaveErrorMessage(message?: string | RegExp): void;
    toHaveFocus(): void;
    toHaveFormValues(expectedValues: Record<string, unknown>): void;
    toHaveRole(role: string): void;
    toHaveStyle(css: string | Record<string, unknown>): void;
    toHaveTextContent(text: string | RegExp, options?: { normalizeWhitespace: boolean }): void;
    toHaveValue(value?: string | string[] | number | null): void;
  }
}
