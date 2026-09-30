import { useState } from "react";
import {
  TIKTOK_BRANDED_CONTENT_POLICY_URL,
  TIKTOK_MUSIC_USAGE_URL,
  TIKTOK_PRIVACY_LABELS,
  TIKTOK_TITLE_MAX_LENGTH,
  tiktokCommercialLabel,
  tiktokDeclarationText,
  validateTikTokPostSettings,
  type TikTokCreatorInfo,
  type TikTokPostSettings,
  type TikTokPrivacyLevel,
} from "../services/tiktok/postSettings";

// Bloco "Post to TikTok" de cada Reel no Weekly Plan (Direct Post,
// Patricia, 30/09/2026). Segue ponto a ponto as diretrizes de UX da
// Content Posting API do TikTok, que a auditoria do Direct Post confere
// (ver tiktok/postSettings.ts): conta de destino visível, privacidade sem
// valor padrão, interações desligadas por padrão e cinza quando a conta
// desliga, divulgação comercial, declaração com o texto exato, aviso de
// processamento, e nada enviado sem a lojista clicar em confirmar.

export type TikTokCreatorState =
  | { status: "not_connected" }
  | { status: "ok"; creator: TikTokCreatorInfo }
  | { status: "error"; reason: string };

type Draft = Omit<TikTokPostSettings, "consentedAt" | "privacyLevel"> & { privacyLevel: TikTokPrivacyLevel | "" };

function draftFrom(saved: TikTokPostSettings | null, defaultTitle: string): Draft {
  if (saved) {
    return {
      privacyLevel: saved.privacyLevel,
      allowComment: saved.allowComment,
      allowDuet: saved.allowDuet,
      allowStitch: saved.allowStitch,
      commercialContent: saved.commercialContent,
      brandOrganic: saved.brandOrganic,
      brandedContent: saved.brandedContent,
      title: saved.title,
    };
  }
  return {
    privacyLevel: "",
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    commercialContent: false,
    brandOrganic: false,
    brandedContent: false,
    title: defaultTitle,
  };
}

const TIKTOK_STATUS_LABELS: Record<string, string> = {
  PROCESSING_DOWNLOAD: "TikTok is processing the video",
  PROCESSING_UPLOAD: "TikTok is processing the video",
  PUBLISH_COMPLETE: "Posted on TikTok",
  SEND_TO_USER_INBOX: "Sent to your TikTok inbox as a draft",
};

const linkStyle = { color: "#005bd3" };

export function TikTokPostPanel(props: {
  editable: boolean;
  saved: TikTokPostSettings | null;
  publishStatus: string | null;
  defaultTitle: string;
  creatorState: TikTokCreatorState;
  isSaving: boolean;
  error: string | null;
  onConfirm: (settings: Omit<TikTokPostSettings, "consentedAt">) => void;
  onClear: () => void;
}) {
  const { editable, saved, publishStatus, defaultTitle, creatorState, isSaving, error, onConfirm, onClear } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved, defaultTitle));

  const box = (children: React.ReactNode) => (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-heading>TikTok</s-heading>
        {children}
      </s-stack>
    </s-box>
  );

  if (!editable) {
    if (publishStatus) {
      const label = publishStatus.startsWith("FAILED")
        ? `TikTok couldn't post this video (${publishStatus.replace(/^FAILED:\s*/, "")})`
        : (TIKTOK_STATUS_LABELS[publishStatus] ?? publishStatus);
      return box(<s-paragraph>{label}</s-paragraph>);
    }
    return null;
  }

  if (creatorState.status === "not_connected") return null;
  if (creatorState.status === "error") {
    return box(
      <s-paragraph>
        Couldn&apos;t reach your TikTok account ({creatorState.reason}). Try reconnecting TikTok in
        Social accounts.
      </s-paragraph>,
    );
  }
  const creator = creatorState.creator;
  const account = (
    <s-stack direction="inline" gap="small" alignItems="center">
      {creator.avatarUrl && (
        <img src={creator.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: 999 }} />
      )}
      <s-text>
        Posting to <strong>{creator.nickname}</strong>
        {creator.username && ` (@${creator.username})`}
      </s-text>
    </s-stack>
  );

  if (saved && !isEditing) {
    const commercialLabel = tiktokCommercialLabel(saved);
    return box(
      <>
        {account}
        <s-paragraph>
          ✓ Will post automatically with this Reel · Visible to:{" "}
          {TIKTOK_PRIVACY_LABELS[saved.privacyLevel]}
          {commercialLabel && ` · labeled "${commercialLabel}"`}
        </s-paragraph>
        <s-stack direction="inline" gap="small">
          <button
            type="button"
            onClick={() => {
              setDraft(draftFrom(saved, defaultTitle));
              setIsEditing(true);
            }}
            style={secondaryButton(false)}
          >
            Edit TikTok settings
          </button>
          <button type="button" onClick={onClear} disabled={isSaving} style={secondaryButton(isSaving)}>
            Don&apos;t post to TikTok
          </button>
        </s-stack>
      </>,
    );
  }

  if (creator.privacyLevelOptions.length === 0) {
    return box(
      <>
        {account}
        <s-paragraph>
          Your TikTok account can&apos;t receive new posts right now (TikTok may have reached its
          daily posting limit). Try again later.
        </s-paragraph>
      </>,
    );
  }

  const invalidReason = validateTikTokPostSettings(draft, creator);
  const brandedContentPrivateConflict = draft.commercialContent && draft.brandedContent;
  const declaration = tiktokDeclarationText(draft);
  const commercialLabel = tiktokCommercialLabel(draft);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return box(
    <>
      {account}

      <label style={{ display: "block" }}>
        <span style={{ fontWeight: 500 }}>Caption</span>
        <textarea
          value={draft.title}
          maxLength={TIKTOK_TITLE_MAX_LENGTH}
          onChange={(e) => set({ title: e.target.value })}
          rows={3}
          style={{ width: "100%", padding: 8, marginTop: 4 }}
        />
      </label>

      <label style={{ display: "block" }}>
        <span style={{ fontWeight: 500 }}>Who can see this video</span>
        <select
          value={draft.privacyLevel}
          onChange={(e) => set({ privacyLevel: e.target.value as TikTokPrivacyLevel | "" })}
          style={{ display: "block", marginTop: 4, padding: 6 }}
        >
          <option value="" disabled>
            Select who can see this
          </option>
          {creator.privacyLevelOptions.map((level) => {
            const blocked = level === "SELF_ONLY" && brandedContentPrivateConflict;
            return (
              <option
                key={level}
                value={level}
                disabled={blocked}
                title={blocked ? "Branded content visibility cannot be set to private" : undefined}
              >
                {TIKTOK_PRIVACY_LABELS[level]}
                {blocked ? " (not available for branded content)" : ""}
              </option>
            );
          })}
        </select>
      </label>

      <div>
        <span style={{ fontWeight: 500 }}>Allow users to</span>
        <s-stack direction="inline" gap="base">
          <Checkbox
            label="Comment"
            checked={draft.allowComment}
            disabled={creator.commentDisabled}
            onChange={(checked) => set({ allowComment: checked })}
          />
          <Checkbox
            label="Duet"
            checked={draft.allowDuet}
            disabled={creator.duetDisabled}
            onChange={(checked) => set({ allowDuet: checked })}
          />
          <Checkbox
            label="Stitch"
            checked={draft.allowStitch}
            disabled={creator.stitchDisabled}
            onChange={(checked) => set({ allowStitch: checked })}
          />
        </s-stack>
      </div>

      <div>
        <Checkbox
          label="Disclose video content"
          bold
          checked={draft.commercialContent}
          onChange={(checked) =>
            set(checked ? { commercialContent: true } : { commercialContent: false, brandOrganic: false, brandedContent: false })
          }
        />
        <p style={{ fontSize: 12, color: "#6d7175", margin: "2px 0 6px 24px" }}>
          Turn on to disclose that this video promotes goods or services in exchange for something
          of value. Your video could promote yourself, a third party, or both.
        </p>
        {draft.commercialContent && (
          <div style={{ marginLeft: 24 }}>
            <Checkbox
              label="Your brand"
              checked={draft.brandOrganic}
              onChange={(checked) => set({ brandOrganic: checked })}
            />
            <p style={{ fontSize: 12, color: "#6d7175", margin: "2px 0 6px 24px" }}>
              You are promoting yourself or your own business. This content will be labeled as
              &quot;Promotional content&quot;.
            </p>
            <Checkbox
              label="Branded content"
              checked={draft.brandedContent}
              disabled={draft.privacyLevel === "SELF_ONLY"}
              title={draft.privacyLevel === "SELF_ONLY" ? "Branded content visibility cannot be set to private" : undefined}
              onChange={(checked) => set({ brandedContent: checked })}
            />
            <p style={{ fontSize: 12, color: "#6d7175", margin: "2px 0 6px 24px" }}>
              You are promoting another brand or a third party. This content will be labeled as
              &quot;Paid partnership&quot;.
            </p>
            {commercialLabel && (
              <p style={{ fontSize: 12, margin: "2px 0 6px 0" }}>
                Your video will be labeled &quot;{commercialLabel}&quot;.
              </p>
            )}
          </div>
        )}
      </div>

      <p style={{ fontSize: 12, color: "#6d7175", margin: 0 }}>
        By posting, you agree to TikTok&apos;s{" "}
        {declaration.hasBrandedContentPolicy && (
          <>
            <a href={TIKTOK_BRANDED_CONTENT_POLICY_URL} target="_blank" rel="noreferrer" style={linkStyle}>
              Branded Content Policy
            </a>{" "}
            and{" "}
          </>
        )}
        <a href={TIKTOK_MUSIC_USAGE_URL} target="_blank" rel="noreferrer" style={linkStyle}>
          Music Usage Confirmation
        </a>
        .
      </p>
      <p style={{ fontSize: 12, color: "#6d7175", margin: 0 }}>
        This Reel posts to TikTok automatically at its scheduled time, together with Instagram.
        After it&apos;s posted, it may take a few minutes for the video to process and be visible on
        your TikTok profile.
      </p>

      {error && (
        <s-paragraph>
          <strong>{error}</strong>
        </s-paragraph>
      )}

      <s-stack direction="inline" gap="small">
        <button
          type="button"
          disabled={Boolean(invalidReason) || isSaving}
          title={invalidReason ?? undefined}
          onClick={() => {
            if (!draft.privacyLevel) return;
            // Sem fechar o formulário aqui: quando salva, o consentedAt novo
            // muda a key do painel e ele remonta já no resumo; se falhar, o
            // formulário continua aberto mostrando o erro.
            onConfirm({ ...draft, privacyLevel: draft.privacyLevel });
          }}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: 8,
            background: "#202223",
            color: "#ffffff",
            fontWeight: 500,
            opacity: invalidReason || isSaving ? 0.5 : 1,
            cursor: invalidReason || isSaving ? "default" : "pointer",
          }}
        >
          {isSaving ? "Saving…" : "Post this Reel to TikTok"}
        </button>
        {saved && (
          <button type="button" onClick={() => setIsEditing(false)} style={secondaryButton(false)}>
            Cancel
          </button>
        )}
      </s-stack>
      {invalidReason && draft.privacyLevel !== "" && (
        <p style={{ fontSize: 12, color: "#d72c0d", margin: 0 }}>{invalidReason}</p>
      )}
    </>,
  );
}

function secondaryButton(disabled: boolean) {
  return {
    padding: "8px 16px",
    border: "1px solid #a8abae",
    borderRadius: 8,
    background: "#f1f2f3",
    color: "#202223",
    fontWeight: 500,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "default" : "pointer",
  } as const;
}

function Checkbox(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  bold?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      title={props.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontWeight: props.bold ? 500 : 400,
        color: props.disabled ? "#8c9196" : undefined,
        cursor: props.disabled ? "default" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={props.checked && !props.disabled}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}
