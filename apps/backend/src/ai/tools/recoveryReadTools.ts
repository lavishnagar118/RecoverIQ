import type { AiToolDefinition } from "../types.js";

export const recoveryReadOnlyTools: readonly AiToolDefinition[] = [
  {
    name: "getRecoveryCase",
    description: "Read the sanitized recovery case supplied by the backend.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "getCustomerHistory",
    description: "Read aggregate customer recovery history supplied by the backend.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "getBaselineDecision",
    description: "Read the deterministic recovery score and selected action.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "getActionCandidates",
    description: "Read deterministic action candidates and their eligibility.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "getRecoveryPolicy",
    description: "Read the applicable recovery policy constraints.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];
