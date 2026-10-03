import { useState, type CSSProperties, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShopContentLanguage } from "../services/syncProducts.server";
import { CONTENT_LANGUAGES, getAppLanguage } from "../services/decisionEngine/constants";
import { getWeeklySlotPlan } from "../services/decisionEngine/planTiers.server";
import {
  DEFAULT_WEEKLY_SCHEDULE,
  normalizeCustomSchedule,
} from "../services/decisionEngine/planWeek.server";

// Página de Settings (Patricia, 03/10/2026). Tudo aqui tem default que
// mantém o comportamento de sempre — "tem gente que nem abre o settings".
// Logo e estilo de imagem continuam em Store voice de propósito; pausar um
// canal específico = desconectar a conta em Social accounts.

const PLAN_OPTIONS = [
  {
    value: "basic",
    label: "Basic — €24.90/month",
    description: "3 posts/week (~12/month) — 2 image posts + 1 reel weekly.",
  },
  {
    value: "grow",
    label: "Grow — €37.90/month",
    description: "5 posts/week — 3 image posts + 2 reels weekly.",
  },
  {
    value: "plus",
    label: "Plus — €49.90/month",
    description: "7 posts/week — 4 image posts + 3 reels weekly.",
  },
] as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  let shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  // Relê o idioma padrão da loja aqui (força), pra "Same as your store"
  // refletir uma troca feita depois no admin do Shopify.
  if (shop) {
    await ensureShopContentLanguage(admin, shop, { force: true });
    shop = await prisma.shop.findUnique({ where: { id: shop.id } });
  }

  const postsPerWeek = getWeeklySlotPlan({ plan: shop?.plan ?? "basic" }).postsPerWeek;
  const schedule =
    shop?.postingScheduleMode === "custom"
      ? normalizeCustomSchedule(shop.customPostingSchedule, postsPerWeek)
      : DEFAULT_WEEKLY_SCHEDULE.slice(0, postsPerWeek);

  return {
    plan: shop?.plan ?? "basic",
    // "store" = segue o idioma da loja (appLanguage null).
    appLanguageChoice: shop?.appLanguage ?? "store",
    storeLanguage: getAppLanguage({ storeLanguage: shop?.storeLanguage }),
    contentLanguagePrimary: shop?.contentLanguagePrimary ?? "en",
    contentLanguageSecondary: shop?.contentLanguageSecondary ?? "",
    publishingPaused: Boolean(shop?.publishingPausedAt),
    requireApproval: shop?.requireApproval ?? false,
    postingScheduleMode: shop?.postingScheduleMode === "custom" ? "custom" : "auto",
    schedule: schedule.map((slot) => ({ weekday: slot.weekday, time: `${pad(slot.hour)}:${pad(slot.minute)}` })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const ok = { intent, error: null as string | null };
  const fail = (error: string) => ({ intent, error });

  // Não existe cobrança real ainda (Fase 7, Shopify Billing, fica de fora —
  // ver plano de implementação) — trocar de plano aqui só muda a cadência e
  // a cota que o app usa pra decidir e gerar conteúdo, do mesmo jeito que o
  // piloto já testa hoje direto no banco.
  if (intent === "save-plan") {
    const plan = String(formData.get("plan") ?? "basic");
    if (!PLAN_OPTIONS.some((option) => option.value === plan)) return fail("Unknown plan.");
    await prisma.shop.update({ where: { id: shop.id }, data: { plan } });
    return ok;
  }

  if (intent === "save-app-language") {
    const choice = String(formData.get("appLanguage") ?? "store");
    if (choice !== "store" && !CONTENT_LANGUAGES.some((lang) => lang.code === choice)) {
      return fail("Unknown language.");
    }
    await prisma.shop.update({
      where: { id: shop.id },
      data: { appLanguage: choice === "store" ? null : choice },
    });
    return ok;
  }

  // Mesma regra do "save-language" de Store voice — vale pros próximos
  // posts gerados; posts já gerados mantêm a legenda que têm.
  if (intent === "save-post-languages") {
    const primary = String(formData.get("contentLanguagePrimary") ?? "en");
    const secondaryRaw = String(formData.get("contentLanguageSecondary") ?? "");
    const isKnown = (code: string) => CONTENT_LANGUAGES.some((lang) => lang.code === code);
    if (!isKnown(primary) || (secondaryRaw && !isKnown(secondaryRaw))) return fail("Unknown language.");
    const secondary = secondaryRaw && secondaryRaw !== primary ? secondaryRaw : null;
    await prisma.shop.update({
      where: { id: shop.id },
      data: { contentLanguagePrimary: primary, contentLanguageSecondary: secondary, languageConfirmed: true },
    });
    return ok;
  }

  if (intent === "set-paused") {
    const paused = formData.get("paused") === "1";
    if (paused) {
      await prisma.shop.update({ where: { id: shop.id }, data: { publishingPausedAt: new Date() } });
      return ok;
    }
    // Ao retomar, pula (cancela) os posts cujo horário passou durante a
    // pausa — senão sairiam todos de uma vez na próxima rodada do agendador.
    if (shop.publishingPausedAt) {
      await prisma.contentItem.updateMany({
        where: {
          shopId: shop.id,
          status: { in: ["draft", "approved"] },
          scheduledAt: { gte: shop.publishingPausedAt, lte: new Date() },
        },
        data: { status: "cancelled" },
      });
    }
    await prisma.shop.update({ where: { id: shop.id }, data: { publishingPausedAt: null } });
    return ok;
  }

  if (intent === "set-require-approval") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { requireApproval: formData.get("requireApproval") === "1" },
    });
    return ok;
  }

  // Vale pra próxima semana gerada; posts já agendados mantêm o horário
  // (dá pra mudar cada um no Weekly plan).
  if (intent === "save-schedule") {
    const mode = formData.get("mode") === "custom" ? "custom" : "auto";
    if (mode === "auto") {
      await prisma.shop.update({ where: { id: shop.id }, data: { postingScheduleMode: "auto" } });
      return ok;
    }
    let slots: { weekday: number; hour: number; minute: number }[];
    try {
      const parsed: { weekday: number; time: string }[] = JSON.parse(String(formData.get("schedule") ?? "[]"));
      slots = parsed.map(({ weekday, time }) => {
        const [hour, minute] = String(time).split(":").map(Number);
        return { weekday: Number(weekday), hour, minute };
      });
    } catch {
      return fail("Invalid schedule.");
    }
    const postsPerWeek = getWeeklySlotPlan(shop).postsPerWeek;
    const normalized = normalizeCustomSchedule(slots, postsPerWeek);
    if (slots.length !== postsPerWeek || JSON.stringify(normalized) !== JSON.stringify(slots)) {
      return fail("Pick a day and a time for every post.");
    }
    const keys = slots.map((slot) => `${slot.weekday}-${slot.hour}-${slot.minute}`);
    if (new Set(keys).size !== keys.length) return fail("Two posts can't go out at the same day and time.");
    await prisma.shop.update({
      where: { id: shop.id },
      data: { postingScheduleMode: "custom", customPostingSchedule: normalized },
    });
    return ok;
  }

  return fail("Unknown action.");
};

const buttonStyle = (disabled: boolean): CSSProperties => ({
  display: "inline-block",
  padding: "8px 16px",
  border: "1px solid #000",
  borderRadius: 8,
  background: "#000",
  color: "#fff",
  fontWeight: 500,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? "default" : "pointer",
});

const selectStyle: CSSProperties = { padding: "6px 8px", borderRadius: 8, border: "1px solid #ccc" };

function SaveButton({ onClick, disabled, saving, label }: { onClick: () => void; disabled: boolean; saving: boolean; label: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" onClick={onClick} disabled={disabled || saving} style={buttonStyle(disabled || saving)}>
        {saving ? "Saving…" : label}
      </button>
    </div>
  );
}

// Mensagem "Saved." / erro de um fetcher, só pro intent que ele enviou.
function FetcherResult({ fetcher }: { fetcher: ReturnType<typeof useFetcher<typeof action>> }) {
  if (fetcher.state !== "idle" || !fetcher.data) return null;
  return fetcher.data.error ? (
    <s-paragraph>
      <strong>{fetcher.data.error}</strong>
    </s-paragraph>
  ) : (
    <s-paragraph>Saved.</s-paragraph>
  );
}

function Toggle({ checked, onChange, disabled, children }: { checked: boolean; onChange: (checked: boolean) => void; disabled: boolean; children: ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: disabled ? "default" : "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ marginTop: 4 }}
      />
      <span>{children}</span>
    </label>
  );
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();

  const languageFetcher = useFetcher<typeof action>();
  const postLanguageFetcher = useFetcher<typeof action>();
  const publishingFetcher = useFetcher<typeof action>();
  const scheduleFetcher = useFetcher<typeof action>();
  const planFetcher = useFetcher<typeof action>();

  const submit = (fetcher: ReturnType<typeof useFetcher<typeof action>>, payload: Record<string, string>) =>
    fetcher.submit(payload, { method: "POST" });

  const [selectedLanguage, setSelectedLanguage] = useState(data.appLanguageChoice);
  const storeLanguageLabel =
    CONTENT_LANGUAGES.find((lang) => lang.code === data.storeLanguage)?.label ?? "English";

  const [primary, setPrimary] = useState(data.contentLanguagePrimary);
  const [secondary, setSecondary] = useState(data.contentLanguageSecondary);
  const postLanguagesUnchanged = primary === data.contentLanguagePrimary && secondary === data.contentLanguageSecondary;

  const [scheduleMode, setScheduleMode] = useState(data.postingScheduleMode);
  const [schedule, setSchedule] = useState(data.schedule);
  const scheduleUnchanged =
    scheduleMode === data.postingScheduleMode &&
    (scheduleMode === "auto" || JSON.stringify(schedule) === JSON.stringify(data.schedule));
  const updateSlot = (index: number, change: Partial<{ weekday: number; time: string }>) =>
    setSchedule((current) => current.map((slot, i) => (i === index ? { ...slot, ...change } : slot)));

  const [selectedPlan, setSelectedPlan] = useState(data.plan);

  const isSavingPublishing = publishingFetcher.state !== "idle";

  return (
    <s-page heading="Settings">
      <s-section heading="Publishing">
        <s-stack direction="block" gap="base">
          <Toggle
            checked={data.publishingPaused}
            disabled={isSavingPublishing}
            onChange={(checked) => {
              if (!checked || window.confirm("Pause publishing? No posts go out and no new weeks are generated until you resume.")) {
                submit(publishingFetcher, { intent: "set-paused", paused: checked ? "1" : "0" });
              }
            }}
          >
            <strong>Pause publishing</strong> — nothing is posted and no new
            weeks are generated while paused (e.g. holidays, out of stock).
            When you resume, posts whose time passed during the pause are
            skipped. To stop a single channel, disconnect it in Social
            accounts instead.
          </Toggle>
          <Toggle
            checked={data.requireApproval}
            disabled={isSavingPublishing}
            onChange={(checked) => submit(publishingFetcher, { intent: "set-require-approval", requireApproval: checked ? "1" : "0" })}
          >
            <strong>Approve posts before they publish</strong> — each post in
            your Weekly plan waits for you to click Approve. If you approve
            after its scheduled time, it publishes right away. When this is
            off, posts publish on their own (posts already waiting whose time
            has passed will publish right away).
          </Toggle>
        </s-stack>
        <FetcherResult fetcher={publishingFetcher} />
      </s-section>

      <s-section heading="Posting days and times">
        <s-stack direction="block" gap="base">
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={scheduleMode === "auto"} onChange={() => setScheduleMode("auto")} style={{ marginTop: 4 }} />
            <span>
              <strong>Automatic (recommended)</strong> — the best-performing
              days for fashion, at the hours your Instagram audience is most
              online.
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={scheduleMode === "custom"} onChange={() => setScheduleMode("custom")} style={{ marginTop: 4 }} />
            <span>
              <strong>Choose my own</strong> — one day and time for each post
              in your plan ({schedule.length} per week), in your store's time zone.
            </span>
          </label>

          {scheduleMode === "custom" && (
            <s-stack direction="block" gap="small">
              {schedule.map((slot, index) => (
                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ minWidth: 56 }}>Post {index + 1}</span>
                  <select value={slot.weekday} onChange={(event) => updateSlot(index, { weekday: Number(event.target.value) })} style={selectStyle}>
                    {WEEKDAYS.map((day, weekday) => (
                      <option key={day} value={weekday}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={slot.time}
                    onChange={(event) => updateSlot(index, { time: event.target.value })}
                    style={selectStyle}
                  />
                </div>
              ))}
            </s-stack>
          )}
          <s-paragraph>
            <s-text color="subdued">
              Applies from the next week the AI plans. You can still move any
              single post in the Weekly plan.
            </s-text>
          </s-paragraph>
        </s-stack>
        <SaveButton
          label="Save schedule"
          disabled={scheduleUnchanged}
          saving={scheduleFetcher.state !== "idle"}
          onClick={() => submit(scheduleFetcher, { intent: "save-schedule", mode: scheduleMode, schedule: JSON.stringify(schedule) })}
        />
        <FetcherResult fetcher={scheduleFetcher} />
      </s-section>

      <s-section heading="Post languages">
        <s-paragraph>
          The language your captions are written in. Add a second language and
          every post publishes the full caption in your primary language,
          followed by the same caption in the second. Applies to posts
          generated from now on.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <div>
            <s-paragraph>Primary language</s-paragraph>
            <select value={primary} onChange={(event) => setPrimary(event.target.value)} style={selectStyle}>
              {CONTENT_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <s-paragraph>Second language (optional)</s-paragraph>
            <select value={secondary} onChange={(event) => setSecondary(event.target.value)} style={selectStyle}>
              <option value="">None</option>
              {CONTENT_LANGUAGES.filter((lang) => lang.code !== primary).map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </s-stack>
        <SaveButton
          label="Save post languages"
          disabled={postLanguagesUnchanged}
          saving={postLanguageFetcher.state !== "idle"}
          onClick={() =>
            submit(postLanguageFetcher, {
              intent: "save-post-languages",
              contentLanguagePrimary: primary,
              contentLanguageSecondary: secondary === primary ? "" : secondary,
            })
          }
        />
        <FetcherResult fetcher={postLanguageFetcher} />
      </s-section>

      <s-section heading="App language">
        <s-paragraph>
          The language of the app itself, such as the suggested reasons when
          you regenerate a caption or image. It doesn't change the language
          your posts are published in.
        </s-paragraph>
        <select value={selectedLanguage} onChange={(event) => setSelectedLanguage(event.target.value)} style={selectStyle}>
          <option value="store">Same as your store ({storeLanguageLabel})</option>
          {CONTENT_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
        <SaveButton
          label="Save language"
          disabled={selectedLanguage === data.appLanguageChoice}
          saving={languageFetcher.state !== "idle"}
          onClick={() => submit(languageFetcher, { intent: "save-app-language", appLanguage: selectedLanguage })}
        />
        <FetcherResult fetcher={languageFetcher} />
      </s-section>

      <s-section heading="Plan">
        <s-paragraph>
          Your plan sets how many posts the AI generates automatically each
          week, and how many of them are reels. This never blocks automatic
          posting — it only changes the pace.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {PLAN_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="radio"
                name="plan"
                value={option.value}
                checked={selectedPlan === option.value}
                onChange={() => setSelectedPlan(option.value)}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>{option.label}</strong> — {option.description}
              </span>
            </label>
          ))}
        </s-stack>
        <SaveButton
          label="Save plan"
          disabled={selectedPlan === data.plan}
          saving={planFetcher.state !== "idle"}
          onClick={() => submit(planFetcher, { intent: "save-plan", plan: selectedPlan })}
        />
        <FetcherResult fetcher={planFetcher} />
      </s-section>
    </s-page>
  );
}
