import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import {
  generateStructuredForTask,
  generateTextForTask,
} from "../services/ai/index.server";

const captionIdeaSchema = z.object({
  headline: z.string().describe("A short, punchy headline for the product"),
  tone: z.enum(["playful", "professional", "cozy"]),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "structured") {
    const data = await generateStructuredForTask(
      "decision_engine",
      captionIdeaSchema,
      "Suggest a headline and tone for an Instagram post about a pair of black leather ankle boots that are on sale.",
    );
    return { intent, data };
  }

  const text = await generateTextForTask(
    "creative_copy",
    "Write one short, upbeat Instagram caption idea (max 2 sentences) for a pair of black leather ankle boots on sale.",
  );
  return { intent: "text", text };
};

export default function AiTest() {
  const textFetcher = useFetcher<typeof action>();
  const structuredFetcher = useFetcher<typeof action>();

  const runText = () =>
    textFetcher.submit({ intent: "text" }, { method: "POST" });
  const runStructured = () =>
    structuredFetcher.submit({ intent: "structured" }, { method: "POST" });

  return (
    <s-page heading="AI Provider Layer test">
      <s-section heading="generateText">
        <s-button
          onClick={runText}
          {...(textFetcher.state !== "idle" ? { loading: true } : {})}
        >
          Test generateText
        </s-button>
        {textFetcher.data?.intent === "text" && (
          <s-paragraph>{textFetcher.data.text}</s-paragraph>
        )}
      </s-section>

      <s-section heading="generateStructured">
        <s-button
          onClick={runStructured}
          {...(structuredFetcher.state !== "idle" ? { loading: true } : {})}
        >
          Test generateStructured
        </s-button>
        {structuredFetcher.data?.intent === "structured" && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <pre style={{ margin: 0 }}>
              <code>
                {JSON.stringify(structuredFetcher.data.data, null, 2)}
              </code>
            </pre>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
