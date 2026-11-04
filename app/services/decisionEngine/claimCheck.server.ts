import { z } from "zod";
import { generateStructuredForTask } from "../ai/index.server";

export const claimCheckSchema = z.object({
  violations: z
    .array(z.string())
    .describe("Each unsupported claim, quoted from the post, with what is wrong. Empty when the post is clean."),
});

export interface ClaimSources {
  productTitle: string;
  productDescription: string | null;
  brandDescription: string | null;
  productLineNote: string;
  stockClaimAllowed: boolean;
}

// Regra escrita no prompt não segura sozinha (o Estágio 2 já tinha a ordem de
// não ir além da evidência e mesmo assim publicou "fabriquée à la main au
// Brésil" numa bolsa italiana). Por isso uma segunda IA confere a legenda
// pronta contra as fontes, em qualquer idioma, hashtags incluídas.
export function buildClaimCheckPrompt(
  post: { captionText: string; hashtags: string[]; cta: string },
  sources: ClaimSources,
): string {
  return `You check one social media post for false or outdated claims before it is published. Check only these kinds of claim, in any language:
- how long ago the product arrived or was listed (a number of days, today, yesterday, this week). This is always a violation, because the post publishes later than it is written. Simply calling it new or recent is fine.
${sources.stockClaimAllowed ? "" : "- how many units are left, or that the product is running out or nearly sold out. This is always a violation for this post, because stock will have changed by the time it publishes.\n"}- where the product or its materials are made or come from (including hashtags such as "made in X")
- how it is made (handmade, handcrafted and equivalents)
- who designed, signed, chose or personally made it, or any link between this product and the founder's biography or roots

A claim is supported only if the sources below state it for this product. If a "facts for this product line" note is present, it overrides the brand description. Naming who founded the brand is fine when the sources say so, as long as it does not imply that person designed or made this product. Ignore everything else, including tone, style, stock, prices and benefits.

Sources:
Product title: ${sources.productTitle}
Product description: ${sources.productDescription ?? "(none)"}
Brand description: ${sources.brandDescription?.trim() || "(none)"}
${sources.productLineNote}

Post:
${post.captionText}
CTA: ${post.cta}
Hashtags: ${post.hashtags.join(", ")}`;
}

export async function findUnsupportedClaims(
  post: { captionText: string; hashtags: string[]; cta: string },
  sources: ClaimSources,
): Promise<string[]> {
  const { violations } = await generateStructuredForTask(
    "claim_check",
    claimCheckSchema,
    buildClaimCheckPrompt(post, sources),
  );
  return violations;
}
