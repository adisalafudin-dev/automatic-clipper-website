import { useEffect, useState, type FormEvent } from "react";
import { getLlmSettings, saveLlmSettings, testLlmConnection, type LlmSettings as Settings } from "./api.ts";

export function LlmSettings({ standalone = false }: { standalone?: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState("http://192.168.1.9:20128/v1");
  const [model, setModel] = useState("hermes-main");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLlmSettings().then((value) => {
      setSettings(value);
      setBaseUrl(value.baseUrl);
      setModel(value.model);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const value = await saveLlmSettings({ baseUrl, model, ...(apiKey ? { apiKey } : {}) });
      setSettings(value); setApiKey(""); setBaseUrl(value.baseUrl); setModel(value.model);
      setMessage("Settings saved on this computer. The API key is hidden after saving.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setError(""); setMessage("");
    try { await testLlmConnection(); setMessage("Connected to 9Router. The app server can reach this endpoint and the API key was accepted."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <details className={`panel router-settings ${standalone ? "standalone" : ""}`} open={standalone}>
    <summary><span><strong>9Router settings</strong><small>{settings?.configured ? `Configured · ${settings.model}` : "Add endpoint and API key to enable clip selection"}</small></span><span className="router-settings-chevron" aria-hidden="true">⌄</span></summary>
    <form className="router-settings-form" onSubmit={(event) => void save(event)}>
      <p className="muted">The API key is stored in the local app data folder and is never sent back to the browser. For Docker Desktop with 9Router on this PC, use <code>http://host.docker.internal:20128/v1</code>.</p>
      <label className="form-field"><span>API endpoint</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="http://192.168.1.9:20128/v1" autoComplete="url" /></label>
      <div className="router-settings-grid">
        <label className="form-field"><span>Model or alias</span><input value={model} onChange={(event) => setModel(event.currentTarget.value)} placeholder="hermes-main" /></label>
        <label className="form-field"><span>API key {settings?.configured && <small>Leave blank to keep saved key</small>}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={settings?.configured ? "Saved key · enter only to replace" : "Paste key from 9Router"} autoComplete="new-password" /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="router-settings-message" role="status">{message}</p>}
      <div className="router-settings-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button><button className="button" type="button" disabled={busy || !settings?.configured} onClick={() => void test()}>{busy ? "Testing…" : "Test connection"}</button></div>
    </form>
  </details>;
}
