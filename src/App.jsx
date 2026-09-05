import { useState, useEffect, useMemo, useRef } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SCHEMA = "entregas";

const APPS = {
  anjun: { label: "Anjun", color: "#0F6B5C" },
  imile: { label: "iMile", color: "#C97A2B" },
};

const DEFAULT_TEMPLATE =
  "Oi {nome}! Aqui e da entrega ({app}). Seu pedido esta a caminho para {endereco}. Voce vai estar disponivel pra receber?";

// --- Helpers de acesso ao Supabase via REST (PostgREST), schema "entregas" ---
async function sb(path, { method = "GET", body, extraHeaders = {} } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extraHeaders,
  };
  if (method === "GET" || method === "DELETE") {
    headers["Accept-Profile"] = SCHEMA;
  } else {
    headers["Content-Profile"] = SCHEMA;
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${path} falhou: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function cleanPhone(str) {
  return (str || "").replace(/\D/g, "");
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

function fillTemplate(template, item) {
  return template
    .replace(/\{nome\}/g, item.nome || "cliente")
    .replace(/\{endereco\}/g, item.endereco || "")
    .replace(/\{app\}/g, APPS[item.app] ? APPS[item.app].label : item.app || "");
}

function buildMapsUrl(addresses) {
  const list = addresses.filter(Boolean);
  if (list.length === 0) return null;
  const encoded = list.map((a) => encodeURIComponent(a));
  const destination = encoded[encoded.length - 1];
  const waypoints = encoded.slice(0, -1).join("|");
  let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
}

export default function RotaEntregas() {
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState("importar");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({ nome: "", whatsapp: "", endereco: "", bairro: "", app: "anjun" });
  const [importApp, setImportApp] = useState("anjun");
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [draft, setDraft] = useState([]);
  const fileInputRef = useRef(null);

  async function loadAll() {
    setLoadError("");
    try {
      const [pacotes, historico, settings] = await Promise.all([
        sb("pacotes?select=*&order=created_at.asc"),
        sb("historico?select=*&order=delivered_at.desc"),
        sb("settings?select=*&chave=eq.whatsapp_template"),
      ]);
      setPending(
        (pacotes || []).map((p) => ({ id: p.id, nome: p.nome, whatsapp: p.whatsapp, endereco: p.endereco, bairro: p.bairro, app: p.app, createdAt: p.created_at }))
      );
      setHistory(
        (historico || []).map((h) => ({ id: h.id, nome: h.nome, whatsapp: h.whatsapp, endereco: h.endereco, bairro: h.bairro, app: h.app, deliveredAt: h.delivered_at }))
      );
      if (settings && settings.length > 0) {
        setTemplate(settings[0].valor);
      }
    } catch (e) {
      setLoadError("Não consegui carregar os dados do Supabase agora. Puxe pra atualizar de novo em instantes.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const historyIndex = useMemo(() => {
    const map = {};
    history.forEach((h) => {
      const key = normalize(h.endereco);
      if (!map[key]) map[key] = [];
      map[key].push(h);
    });
    return map;
  }, [history]);

  function repeatInfo(endereco) {
    return historyIndex[normalize(endereco)] || [];
  }

  async function addDelivery() {
    if (!form.endereco.trim() || !form.bairro.trim()) return;
    setSaveError("");
    const payload = {
      nome: form.nome.trim(),
      whatsapp: form.whatsapp.trim(),
      endereco: form.endereco.trim(),
      bairro: form.bairro.trim(),
      app: form.app,
    };
    try {
      const [inserted] = await sb("pacotes", { method: "POST", body: [payload], extraHeaders: { Prefer: "return=representation" } });
      setPending([...pending, { id: inserted.id, ...payload, createdAt: inserted.created_at }]);
      setForm({ nome: "", whatsapp: "", endereco: "", bairro: form.bairro, app: form.app });
    } catch (e) {
      setSaveError("Não consegui salvar essa entrega agora. Tente de novo.");
    }
  }

  async function markDelivered(id) {
    const item = pending.find((p) => p.id === id);
    if (!item) return;
    setSaveError("");
    try {
      const [inserted] = await sb("historico", {
        method: "POST",
        body: [{ nome: item.nome, whatsapp: item.whatsapp, endereco: item.endereco, bairro: item.bairro, app: item.app }],
        extraHeaders: { Prefer: "return=representation" },
      });
      await sb(`pacotes?id=eq.${item.id}`, { method: "DELETE" });
      setPending(pending.filter((p) => p.id !== id));
      setHistory([{ id: inserted.id, nome: item.nome, whatsapp: item.whatsapp, endereco: item.endereco, bairro: item.bairro, app: item.app, deliveredAt: inserted.delivered_at }, ...history]);
    } catch (e) {
      setSaveError("Não consegui marcar como entregue agora. Tente de novo.");
    }
  }

  async function removePending(id) {
    setSaveError("");
    try {
      await sb(`pacotes?id=eq.${id}`, { method: "DELETE" });
      setPending(pending.filter((p) => p.id !== id));
    } catch (e) {
      setSaveError("Não consegui remover agora. Tente de novo.");
    }
  }

  async function saveTemplate(next) {
    setTemplate(next);
    try {
      await sb("settings", {
        method: "POST",
        body: [{ chave: "whatsapp_template", valor: next }],
        extraHeaders: { Prefer: "resolution=merge-duplicates" },
      });
    } catch (e) {
      // falha silenciosa aqui não trava o uso do template nesta sessão
    }
  }

  async function handleExtract() {
    if (!file) return;
    setExtracting(true);
    setExtractError("");
    try {
      const base64Data = await fileToBase64(file);
      const response = await fetch("/api/extract-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Data }),
      });
      if (!response.ok) throw new Error(`extract-pdf falhou: ${response.status}`);
      const data = await response.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      if (!textBlock) throw new Error("empty");
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setExtractError("Não encontrei entregas nesse PDF. Confira o arquivo ou adicione manualmente.");
        setDraft([]);
      } else {
        setDraft(
          parsed.map((item) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            nome: item.nome || "",
            whatsapp: item.whatsapp || "",
            endereco: item.endereco || "",
            bairro: item.bairro || "",
            app: importApp,
            checked: true,
          }))
        );
      }
    } catch (e) {
      setExtractError("Não consegui ler esse PDF agora. Tente novamente ou adicione manualmente.");
      setDraft([]);
    } finally {
      setExtracting(false);
    }
  }

  function updateDraftField(id, field, value) {
    setDraft(draft.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  function toggleDraft(id) {
    setDraft(draft.map((d) => (d.id === id ? { ...d, checked: !d.checked } : d)));
  }

  async function confirmImport() {
    const selected = draft.filter((d) => d.checked && d.endereco.trim());
    if (selected.length === 0) return;
    setSaveError("");
    try {
      const payload = selected.map((d) => ({
        nome: d.nome.trim(),
        whatsapp: d.whatsapp.trim(),
        endereco: d.endereco.trim(),
        bairro: d.bairro.trim() || "Sem bairro",
        app: d.app,
      }));
      const inserted = await sb("pacotes", { method: "POST", body: payload, extraHeaders: { Prefer: "return=representation" } });
      setPending([...pending, ...inserted.map((row) => ({ id: row.id, nome: row.nome, whatsapp: row.whatsapp, endereco: row.endereco, bairro: row.bairro, app: row.app, createdAt: row.created_at }))]);
      setDraft([]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTab("pendentes");
    } catch (e) {
      setSaveError("Não consegui importar essas entregas agora. Tente de novo.");
    }
  }

  const grouped = useMemo(() => {
    const map = {};
    pending.forEach((p) => {
      const key = p.bairro.trim() || "Sem bairro";
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pending]);

  const allPendingAddresses = useMemo(() => grouped.flatMap(([, items]) => items.map((i) => i.endereco)), [grouped]);

  const filteredHistory = useMemo(() => {
    const q = normalize(search);
    const items = [...history];
    if (!q) return items;
    return items.filter(
      (h) => normalize(h.nome).includes(q) || normalize(h.endereco).includes(q) || normalize(h.bairro).includes(q)
    );
  }, [history, search]);

  const s = styles;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div style={s.page}>
        <div style={s.errorBanner}>
          Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (arquivo .env.local em
          desenvolvimento, ou nas Environment Variables do Vercel em produção) antes de usar o app.
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <style>{`
        * { box-sizing: border-box; }
        input, select, button, textarea { font-family: inherit; }
        input:focus, select:focus, textarea:focus { outline: 2px solid #2E3A6E; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid #2E3A6E; outline-offset: 2px; }
      `}</style>

      <header style={s.header}>
        <div style={s.headerTitle}>Rota do dia</div>
        <div style={s.headerSub}>Anjun · iMile — sincronizado via Supabase</div>
      </header>

      {loadError && <div style={s.errorBanner}>{loadError}</div>}
      {saveError && <div style={s.errorBanner}>{saveError}</div>}

      <nav style={s.tabs}>
        {[
          { id: "importar", label: "Importar PDF" },
          { id: "nova", label: "Manual" },
          { id: "pendentes", label: `Pendentes${pending.length ? ` (${pending.length})` : ""}` },
          { id: "historico", label: "Histórico" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...s.tabButton, ...(tab === t.id ? s.tabButtonActive : {}) }}>
            {t.label}
          </button>
        ))}
      </nav>

      {!loaded && <div style={s.muted}>Carregando...</div>}

      {loaded && tab === "importar" && (
        <div style={s.card}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Esse PDF é de qual app?</label>
            <div style={s.appToggle}>
              {Object.entries(APPS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setImportApp(key)}
                  style={{ ...s.appToggleButton, borderColor: val.color, background: importApp === key ? val.color : "transparent", color: importApp === key ? "#fff" : val.color }}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Arquivo PDF do romaneio</label>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files && e.target.files[0])} style={s.input} />
          </div>

          <button style={s.primaryButton} onClick={handleExtract} disabled={!file || extracting}>
            {extracting ? "Lendo PDF..." : "Extrair entregas do PDF"}
          </button>

          {extractError && <div style={s.errorNotice}>{extractError}</div>}

          <div style={s.helperText}>
            Confira os dados extraídos antes de confirmar — o PDF pode vir com formatação diferente e vale checar endereço e WhatsApp.
          </div>

          {draft.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={s.draftHeader}>{draft.length} entregas encontradas</div>
              {draft.map((d) => (
                <div key={d.id} style={s.draftRow}>
                  <div style={s.draftCheckRow}>
                    <input type="checkbox" checked={d.checked} onChange={() => toggleDraft(d.id)} />
                    <span style={{ ...s.appBadge, background: APPS[d.app].color }}>{APPS[d.app].label}</span>
                  </div>
                  <input style={s.draftInput} placeholder="Nome" value={d.nome} onChange={(e) => updateDraftField(d.id, "nome", e.target.value)} />
                  <input style={s.draftInput} placeholder="WhatsApp" value={d.whatsapp} onChange={(e) => updateDraftField(d.id, "whatsapp", e.target.value)} />
                  <input style={s.draftInput} placeholder="Endereço" value={d.endereco} onChange={(e) => updateDraftField(d.id, "endereco", e.target.value)} />
                  <input style={s.draftInput} placeholder="Bairro" value={d.bairro} onChange={(e) => updateDraftField(d.id, "bairro", e.target.value)} />
                </div>
              ))}
              <button style={s.primaryButton} onClick={confirmImport}>
                Adicionar selecionadas à rota
              </button>
            </div>
          )}
        </div>
      )}

      {loaded && tab === "nova" && (
        <div style={s.card}>
          <div style={s.fieldGroup}>
            <label style={s.label}>App</label>
            <div style={s.appToggle}>
              {Object.entries(APPS).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setForm({ ...form, app: key })}
                  style={{ ...s.appToggleButton, borderColor: val.color, background: form.app === key ? val.color : "transparent", color: form.app === key ? "#fff" : val.color }}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Nome do cliente</label>
            <input style={s.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Maria Souza" />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>WhatsApp</label>
            <input style={s.input} value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="Ex: 96 99123-4567" inputMode="tel" />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Endereço completo</label>
            <input style={s.input} value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Rua, número, referência" />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Bairro</label>
            <input style={s.input} value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} placeholder="Ex: Jesus de Nazaré" />
          </div>

          {form.endereco.trim() && repeatInfo(form.endereco).length > 0 && (
            <div style={s.repeatNotice}>
              Já entregou nesse endereço {repeatInfo(form.endereco).length}x antes
              {repeatInfo(form.endereco)[0].nome ? ` (${repeatInfo(form.endereco)[0].nome})` : ""}.
            </div>
          )}

          <button style={s.primaryButton} onClick={addDelivery}>
            Adicionar à rota
          </button>
        </div>
      )}

      {loaded && tab === "pendentes" && (
        <div>
          <div style={s.templateBox}>
            <label style={s.label}>Mensagem padrão do WhatsApp</label>
            <textarea style={s.textarea} value={template} onChange={(e) => saveTemplate(e.target.value)} rows={2} />
            <div style={s.helperTextSmall}>Use {"{nome}"}, {"{endereco}"} e {"{app}"} — são preenchidos automaticamente.</div>
          </div>

          {allPendingAddresses.length > 1 && (
            <a style={s.mapButtonWide} href={buildMapsUrl(allPendingAddresses)} target="_blank" rel="noreferrer">
              Abrir rota completa no Google Maps ({allPendingAddresses.length} paradas)
            </a>
          )}

          <div style={s.list}>
            {grouped.length === 0 && (
              <div style={s.emptyState}>Nenhum pacote pendente. Importe um PDF ou adicione manualmente — pacotes do mesmo bairro aparecem juntos aqui.</div>
            )}
            {grouped.map(([bairro, items]) => (
              <div key={bairro} style={s.groupCard}>
                <div style={s.groupHeader}>
                  <span style={s.groupName}>{bairro}</span>
                  {items.length > 1 && <span style={s.groupCount}>{items.length} pacotes juntos</span>}
                </div>

                {items.length > 1 && (
                  <a style={s.mapButtonSmall} href={buildMapsUrl(items.map((i) => i.endereco))} target="_blank" rel="noreferrer">
                    Abrir rota deste bairro no Maps
                  </a>
                )}

                {items.map((item) => (
                  <div key={item.id} style={s.deliveryRow}>
                    <div style={s.deliveryMain}>
                      <div style={s.deliveryTop}>
                        <span style={{ ...s.appBadge, background: APPS[item.app].color }}>{APPS[item.app].label}</span>
                        {item.nome && <span style={s.deliveryName}>{item.nome}</span>}
                      </div>
                      <div style={s.deliveryAddress}>{item.endereco}</div>
                      {repeatInfo(item.endereco).length > 0 && <div style={s.repeatTag}>já entregou aqui {repeatInfo(item.endereco).length}x</div>}
                    </div>
                    <div style={s.deliveryActions}>
                      <a style={s.iconLink} href={`https://maps.google.com/?q=${encodeURIComponent(item.endereco)}`} target="_blank" rel="noreferrer">
                        Ver no Maps
                      </a>
                      {cleanPhone(item.whatsapp) && (
                        <a style={s.iconLink} href={`https://wa.me/55${cleanPhone(item.whatsapp)}?text=${encodeURIComponent(fillTemplate(template, item))}`} target="_blank" rel="noreferrer">
                          Mensagem
                        </a>
                      )}
                      <button style={s.successButton} onClick={() => markDelivered(item.id)}>
                        Entregue
                      </button>
                      <button style={s.ghostButton} onClick={() => removePending(item.id)}>
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {loaded && tab === "historico" && (
        <div>
          <input style={{ ...s.input, marginBottom: 12 }} placeholder="Buscar por nome, endereço ou bairro" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div style={s.list}>
            {filteredHistory.length === 0 && (
              <div style={s.emptyState}>
                {history.length === 0 ? "Nenhuma entrega concluída ainda. Assim que marcar como entregue, o histórico fica aqui." : "Nada encontrado para essa busca."}
              </div>
            )}
            {filteredHistory.map((h) => (
              <div key={h.id} style={s.historyRow}>
                <div style={s.deliveryTop}>
                  <span style={{ ...s.appBadge, background: APPS[h.app].color }}>{APPS[h.app].label}</span>
                  {h.nome && <span style={s.deliveryName}>{h.nome}</span>}
                  <span style={s.historyDate}>{formatDate(h.deliveredAt)}</span>
                </div>
                <div style={s.deliveryAddress}>{h.endereco}</div>
                <div style={s.deliveryBairro}>{h.bairro}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { background: "#FAF7F2", minHeight: "100vh", padding: "16px 14px 32px", color: "#1A1A1A", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", maxWidth: 480, margin: "0 auto" },
  header: { marginBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },
  headerSub: { fontSize: 13, color: "#6B6558", marginTop: 2 },
  errorBanner: { background: "#FBEAEA", color: "#9B3A3A", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 10 },
  tabs: { display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #E4DFD4", paddingBottom: 8, flexWrap: "wrap" },
  tabButton: { flex: "1 1 auto", padding: "8px 6px", border: "1px solid #E4DFD4", borderRadius: 8, background: "#fff", color: "#6B6558", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  tabButtonActive: { background: "#2E3A6E", borderColor: "#2E3A6E", color: "#fff" },
  muted: { color: "#6B6558", fontSize: 14, padding: 20, textAlign: "center" },
  card: { background: "#fff", border: "1px solid #E4DFD4", borderRadius: 12, padding: 16 },
  fieldGroup: { marginBottom: 12 },
  label: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#6B6558", marginBottom: 4 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D8D2C4", fontSize: 15, background: "#FAF7F2", color: "#1A1A1A" },
  textarea: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #D8D2C4", fontSize: 13.5, background: "#FAF7F2", color: "#1A1A1A", resize: "vertical" },
  appToggle: { display: "flex", gap: 8 },
  appToggleButton: { flex: 1, padding: "9px 0", borderRadius: 8, border: "1.5px solid", fontWeight: 700, fontSize: 14, cursor: "pointer", background: "transparent" },
  primaryButton: { width: "100%", padding: "12px 0", borderRadius: 9, border: "none", background: "#2E3A6E", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4 },
  repeatNotice: { background: "#EFEBFB", color: "#2E3A6E", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 12 },
  errorNotice: { color: "#9B3A3A", fontSize: 12.5, marginTop: 8 },
  helperText: { fontSize: 12, color: "#6B6558", marginTop: 10 },
  helperTextSmall: { fontSize: 11, color: "#6B6558", marginTop: 4 },
  templateBox: { background: "#fff", border: "1px solid #E4DFD4", borderRadius: 12, padding: 12, marginBottom: 12 },
  mapButtonWide: { display: "block", textAlign: "center", background: "#1A73E8", color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "11px 0", borderRadius: 9, textDecoration: "none", marginBottom: 14 },
  mapButtonSmall: { display: "inline-block", fontSize: 11.5, fontWeight: 700, color: "#1A73E8", textDecoration: "none", marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  emptyState: { color: "#6B6558", fontSize: 13.5, padding: 24, textAlign: "center", background: "#fff", border: "1px dashed #D8D2C4", borderRadius: 12 },
  groupCard: { background: "#fff", border: "1px solid #E4DFD4", borderRadius: 12, padding: 12 },
  groupHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  groupName: { fontWeight: 800, fontSize: 15 },
  groupCount: { fontSize: 11.5, fontWeight: 700, color: "#C97A2B", background: "#FBEEDF", padding: "3px 8px", borderRadius: 20 },
  deliveryRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: "1px solid #F0ECE2" },
  deliveryMain: { flex: 1, minWidth: 0 },
  deliveryTop: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 },
  appBadge: { color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 20 },
  deliveryName: { fontSize: 13.5, fontWeight: 600 },
  historyDate: { fontSize: 11.5, color: "#6B6558", marginLeft: "auto" },
  deliveryAddress: { fontSize: 14, color: "#3A362D" },
  deliveryBairro: { fontSize: 12, color: "#6B6558", marginTop: 2 },
  repeatTag: { fontSize: 11.5, color: "#0F6B5C", marginTop: 3, fontWeight: 600 },
  deliveryActions: { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" },
  iconLink: { fontSize: 11.5, color: "#0F6B5C", fontWeight: 700, textDecoration: "none" },
  successButton: { fontSize: 12, fontWeight: 700, color: "#fff", background: "#4A7C59", border: "none", borderRadius: 7, padding: "5px 10px", cursor: "pointer" },
  ghostButton: { fontSize: 11, color: "#9B3A3A", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px" },
  historyRow: { background: "#fff", border: "1px solid #E4DFD4", borderRadius: 10, padding: 10 },
  draftHeader: { fontWeight: 700, fontSize: 13.5, marginBottom: 8 },
  draftRow: { border: "1px solid #E4DFD4", borderRadius: 9, padding: 8, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 },
  draftCheckRow: { display: "flex", alignItems: "center", gap: 8 },
  draftInput: { width: "100%", padding: "7px 9px", borderRadius: 6, border: "1px solid #D8D2C4", fontSize: 13, background: "#FAF7F2" },
};
