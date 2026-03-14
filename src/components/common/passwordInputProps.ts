/**
 * Shared attributes for password controls that should never participate in
 * browser or extension autofill/remember-password flows.
 */
export const PASSWORD_INPUT_PROPS = {
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
  "data-lpignore": "true",
} as const;
