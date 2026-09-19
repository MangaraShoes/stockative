import type { OnboardingStatus } from "../services/onboardingStatus.server";

interface Step {
  keys: (keyof OnboardingStatus)[];
  label: string;
  // Mais de uma URL quando a fase abrange mais de uma página (ex.: content
  // pillars + weekly plan fundidos) — a primeira é o alvo padrão do "Next
  // step" e do redirect; todas contam como "estar nesta fase" pro stepper
  // reconhecer a página atual (Patricia, 12/09/2026: "acho que o 5 e 6
  // devem se fundir").
  hrefs: string[];
}

// Ordem fixa da sequência de setup — mesma ordem da checklist "Get started"
// da Home e do gate de navegação em app.tsx. Social vem ANTES de brand voice
// porque o rascunho de brand voice por IA é construído em cima do Instagram
// real da cliente (bio, posts) junto com o About Us e os produtos da loja
// (Patricia, 12/09/2026: "ele vai precisar de informações do IG da cliente e
// da loja do shopify") — pedir a fase 3 antes da 2 deixaria a cliente sem o
// insumo que o rascunho promete usar.
const STEPS: Step[] = [
  { keys: ["hasStock"], label: "Sync your stock", hrefs: ["/app/products"] },
  { keys: ["hasSocial"], label: "Connect your social accounts", hrefs: ["/app/social"] },
  { keys: ["hasCompetitors"], label: "Add competitor accounts", hrefs: ["/app/competitors"] },
  { keys: ["hasBrand"], label: "Set your store voice", hrefs: ["/app/store-voice"] },
  {
    keys: ["hasContentPillars", "hasPublished"],
    label: "Get your weekly plan",
    hrefs: ["/app/content-pillars", "/app/plan-week"],
  },
];

// Barra de progresso mostrada no topo das páginas de setup, uma "sequência
// de páginas" guiada (Patricia, 12/09/2026) — some sozinha assim que todos
// os passos estiverem feitos, pra não virar poluição visual depois do setup.
export function OnboardingStepper({
  status,
  currentStepHref,
}: {
  status: OnboardingStatus;
  currentStepHref: string;
}) {
  const isDone = (step: Step) => step.keys.every((k) => status[k]);
  const isComplete = STEPS.every(isDone);
  if (isComplete) return null;

  const isOnStep = (step: Step) => step.hrefs.includes(currentStepHref);
  const currentIndex = STEPS.findIndex(isOnStep);
  const nextIncomplete = STEPS.find((step) => !isDone(step));
  const onNextIncompleteStep = nextIncomplete ? isOnStep(nextIncomplete) : false;
  // "Continue to the next one" não faz sentido na última fase — não tem
  // próxima (Patricia, 12/09/2026: "isn't necessary still showing" no step
  // 5 de 5).
  const isLastStep = nextIncomplete ? STEPS.indexOf(nextIncomplete) === STEPS.length - 1 : false;

  return (
    <>
    <s-section
      heading={
        currentIndex >= 0
          ? `Setting up Stockative — step ${currentIndex + 1} of ${STEPS.length}`
          : "Setting up Stockative"
      }
    >
      <s-stack direction="inline" gap="small" alignItems="center">
        {STEPS.map((step, index) => (
          <s-badge
            key={step.hrefs[0]}
            tone={isDone(step) ? "success" : index === currentIndex ? "info" : "neutral"}
          >
            {index + 1}. {step.label}
          </s-badge>
        ))}
      </s-stack>

      {nextIncomplete && onNextIncompleteStep && !isLastStep && (
        <s-paragraph>
          Finish this step, then continue to the next one in the sequence.
        </s-paragraph>
      )}
    </s-section>

    {/* Este passo já terminou, mas outro na sequência não — mesmo destaque
        central usado na Home, pra ação de "ir pro próximo passo" nunca
        ficar menor que uma ação secundária da própria página (Patricia,
        12/09/2026: "ficou confuso novamente" com o botão de sync ainda em
        destaque no canto e o próximo passo só num linkzinho de texto). */}
    {nextIncomplete && !onNextIncompleteStep && (
      <s-section>
        <s-box padding="large" borderRadius="large" background="strong">
          <s-stack direction="block" gap="base" alignItems="center">
            <s-badge tone="info">Next step</s-badge>
            <s-button href={nextIncomplete.hrefs[0]} variant="primary">
              {nextIncomplete.label}
            </s-button>
          </s-stack>
        </s-box>
      </s-section>
    )}
    </>
  );
}
