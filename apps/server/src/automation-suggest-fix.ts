// Automation: Framework tab. AI "suggest a fix" for a failing test case —
// calls an OpenAI-compatible /chat/completions endpoint the same way
// apps/server/src/index.ts's /api/projects/:id/agent/chat handler does
// (plain fetch, OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL env vars, a
// 503-style error when no key is configured).
import { readFile } from "./automation-framework.js";
import type { FrameworkProject, TestRun } from "../../../packages/shared/src/index.js";

export interface SuggestedFix {
  path: string;
  diff: string;
  explanation: string;
}

/**
 * Asks the configured model for a fix to a failing test case, grounded in
 * the actual file content and the captured error. Falls back to returning
 * the raw model text as `explanation` (with an empty `diff`) if the model
 * doesn't respond with the requested JSON shape.
 */
export async function suggestFix(
  frameworkProject: FrameworkProject,
  testRun: TestRun,
  caseName: string,
  filePath: string,
): Promise<SuggestedFix> {
  const matchingCase = testRun.cases.find((c) => c.name === caseName);
  if (!matchingCase) throw new Error(`No test case named ${JSON.stringify(caseName)} in this run.`);
  if (matchingCase.status !== "failed")
    throw new Error(`Test case ${JSON.stringify(caseName)} did not fail — nothing to fix.`);

  const fileContent = await readFile(frameworkProject, filePath);

  if (!process.env.OPENAI_API_KEY)
    throw new Error("Configure OPENAI_API_KEY to use suggested fixes.");

  const endpoint = `${(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            'You are a test-automation expert. Given a failing test file and its error, respond ONLY with a JSON object {"diff": <unified diff fixing the file>, "explanation": <one paragraph>}.',
        },
        {
          role: "user",
          content: `File: ${filePath}\n\n${fileContent}\n\nFailing case: ${caseName}\nError: ${matchingCase.error || "(no error captured)"}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const result: any = await response.json();
  if (!response.ok)
    throw new Error(result?.error?.message || `Model request failed (${response.status})`);

  const content = result.choices?.[0]?.message?.content;
  let diff = "";
  let explanation = typeof content === "string" ? content : "";
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.diff === "string") diff = parsed.diff;
        if (typeof parsed.explanation === "string") explanation = parsed.explanation;
      }
    } catch {
      // Fall back to the raw text as the explanation, empty diff.
    }
  }

  return { path: filePath, diff, explanation };
}
