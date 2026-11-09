"use client";

import { useT } from "@/lib/use-i18n";
import { engineName } from "@/lib/control-room";
import { StarterTeam } from "./StarterTeam";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { onboarding, onboardingChatHref, type OnboardingState } from "@/lib/onboarding";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Input";

export function FirstRun({ initial }: { initial: OnboardingState }) {
  const t = useT();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [base, setBase] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const next = await onboarding.detect();
        if (!live) return;
        setState(next); setError(null);
        if (next.status !== "pending") return;
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Engine detection failed. Retrying.");
      }
      if (live) timer = setTimeout(() => void check(), 5000);
    }
    void check();
    return () => { live = false; clearTimeout(timer); };
  }, []);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.saveEngineConfig("openai_compat", { base_url: base, api_key: key, model });
      setKey("");
      setState(await onboarding.detect());
    } catch (err) { setError(err instanceof Error ? err.message : "The account settings could not be saved."); }
    finally { setSaving(false); }
  }

  return <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-5 py-8">
    {error && <Banner tone="danger">{t(error)}</Banner>}
    {state.status === "configured" ? <section className="space-y-4 rounded-card border border-line bg-raised p-5">
      <h1 className="text-heading font-semibold">{t("Chief is ready")}</h1>
      <p>{t("Chief uses {engine} and asks before it acts.", { engine: engineName(state.draft.provider) })}</p>
      <Link href={onboardingChatHref(state)} className="inline-flex min-h-11 items-center justify-center rounded-field bg-accent px-4 text-sm font-semibold text-accent-fg">{t("Chat with Chief")}</Link>
      <StarterTeam />
      <p className="text-sm text-muted"><Link href="/settings/phone/" className="inline-flex min-h-11 items-center underline">{t("You can also use Chief on your phone.")}</Link></p>
    </section> : <section className="space-y-5 rounded-card border border-line bg-raised p-5">
      <h1 className="text-heading font-semibold">{t("Choose how Chief can work")}</h1>
      <p className="text-sm text-muted" role="status">{t("Checking this computer automatically. Chief appears when an engine is ready.")}</p>
      <div className="space-y-2"><h2 className="font-medium">{t("Use an AI already installed")}</h2>
        <p>{t("In a terminal on this computer, run")} <code>claude auth login</code> {t("or run")} <code>codex login</code> {t("to sign in.")}</p>
      </div>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2 className="font-medium">{t("Connect an AI account")}</h2>
        <Field label={t("Service address")}>{props => <Input {...props} type="url" required value={base} onChange={e => setBase(e.target.value)} />}</Field>
        <Field label={t("Model")}>{props => <Input {...props} required value={model} onChange={e => setModel(e.target.value)} />}</Field>
        <Field label={t("Account key")}>{props => <Input {...props} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} />}</Field>
        <Button type="submit" disabled={saving}>{t(saving ? "Saving" : "Save account settings")}</Button>
      </form>
      <div className="space-y-2"><h2 className="font-medium">{t("Use a local model")}</h2>
        <p>{t("Install Ollama or LM Studio, then load a model. For Ollama, run")} <code>ollama run llama3.2</code>{t(". For LM Studio, start its local server on port 1234.")}</p>
        <p className="text-sm text-muted">{t("Chief checks for local models automatically. Download a model in Ollama or LM Studio first.")}</p>
      </div>
    </section>}
  </main>;
}
