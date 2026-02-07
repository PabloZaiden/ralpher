/**
 * Frontend test setup for happy-dom environment.
 *
 * This file registers the happy-dom global DOM environment and sets up
 * necessary mocks for browser APIs used by the React components.
 *
 * It is loaded as a preload script for frontend tests only (via bunfig.toml).
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Bun's expect with jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.)
expect.extend(matchers);

// Register happy-dom globals (window, document, navigator, etc.)
GlobalRegistrator.register();

// Mock ResizeObserver (not implemented in happy-dom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock window.matchMedia (not implemented in happy-dom)
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Mock window.scrollTo (not implemented in happy-dom)
window.scrollTo = () => {};

// Mock IntersectionObserver (not implemented in happy-dom)
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Set a proper base URL so relative fetch URLs (e.g. "/api/loops") work correctly.
// Without this, document.location is "about:blank" and new Request("/api/...") throws.
if (window.location.href === "about:blank") {
  window.location.href = "http://localhost:3000/";
}

// Clean up after each test to prevent DOM leaks between tests
afterEach(() => {
  cleanup();
});

// Reset location hash before each test
beforeEach(() => {
  window.location.hash = "#/";
});
