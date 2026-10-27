import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session } from "@supabase/supabase-js";
import "./styles.css";
const cfg = await fetch("/api/config").then((r) => r.json());
const supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey);
function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [document, setDocument] = useState<any>(null),
    [client, setClient] = useState<any>(null),
    [purchases, setPurchases] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [entitled, setEntitled] = useState(false),
    [content, setContent] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dataReady, setDataReady] = useState(false);
  const activeUser = useRef<string | null>(null);
  const load = async () => {
    const expectedUser = activeUser.current;
    const results = await Promise.all([
      supabase.from("pac_documents").select("*").single(),
      supabase.from("pac_clients").select("display_name").maybeSingle(),
      supabase
        .from("pac_purchases")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("pac_crm_jobs").select("*"),
      supabase.from("pac_entitlements").select("document_id"),
    ]);
    if (activeUser.current !== expectedUser) return;
    const failed = results.find((r) => r.error);
    if (failed?.error) throw Error(failed.error.message);
    setDocument(results[0].data);
    setClient(results[1].data);
    setPurchases(results[2].data || []);
    setJobs(results[3].data || []);
    setEntitled(!!results[4].data?.length);
    setDataReady(true);
  };
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      activeUser.current = data.session?.user.id || null;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      const changed = activeUser.current !== (s?.user.id || null);
      activeUser.current = s?.user.id || null;
      setSession(s);
      if (changed) {
        setDataReady(false);
        setContent("");
        setPurchases([]);
        setJobs([]);
        setEntitled(false);
        setClient(null);
        setError("");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const refresh = () =>
      load().catch((e) => {
        if (alive) setError(e.message);
      });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session?.user.id]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  const api = async (path: string, body?: unknown) => {
    const { data } = await supabase.auth.getSession();
    const r = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token}`,
      },
      body: JSON.stringify(body || {}),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  };
  const paid = purchases.find((p) => p.status === "paid");
  const job = jobs.find((j) => j.purchase_id === paid?.id);
  const returned = new URLSearchParams(location.search).get("checkout");
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="Fieldnotes home">
          <span className="brand-icon">f.</span>fieldnotes
          <span className="brand-divider" />
          CLIENT LIBRARY
        </a>
        <div className="header-right">
          <span className="test-badge">
            <i />
            TEST ENVIRONMENT
          </span>
          {session && (
            <button
              className="text-button"
              onClick={() =>
                run(async () => {
                  await supabase.auth.signOut({ scope: "local" });
                  history.replaceState(null, "", "/");
                  setNotice("");
                })
              }
            >
              Sign out ↗
            </button>
          )}
        </div>
      </header>
      {!ready ? (
        <main>
          <p>Loading your library...</p>
        </main>
      ) : !session ? (
        <main className="signin-grid">
          <section>
            <p className="eyebrow">KNOWLEDGE, WITHOUT THE NOISE</p>
            <h1>
              A little clarity.
              <br />A lot of possibility.
            </h1>
            <p className="lede">
              Your private library of practical ideas.
              <br />
              Sign in to explore, purchase, and read.
            </p>
            <div className="intro-note">
              <span>01 /</span>
              <p>
                One secure place for your documents.
                <br />
                <small>Access follows your account, wherever you work.</small>
              </p>
            </div>
          </section>
          <section className="signin-card">
            <span className="mini-label">YOUR WORKSPACE</span>
            <h2>Welcome back.</h2>
            <p>Sign in with your assessment client account.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                  });
                  if (error) throw error;
                });
              }}
            >
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="alice@example.test"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? "Signing in..." : "Enter your library →"}
              </button>
            </form>
            <div className="secure-note">
              ◈ Supabase identity · Private by default
            </div>
          </section>
        </main>
      ) : (
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR PERSONAL WORKSPACE</p>
              <h1>
                The client library<span className="title-dot">.</span>
              </h1>
              <p className="lede">
                Welcome, {client?.display_name || session.user.email}. Good
                ideas belong here.
              </p>
            </div>
            <div className="collection-label">
              <span>COLLECTION</span>
              <strong>01</strong>
              <small>CURATED DOCUMENT</small>
            </div>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {returned === "success" &&
            !entitled &&
            purchases.some((p) => p.status === "pending") && (
              <p role="status" className="notice">
                Checking your payment. Access appears here after the verified
                payment webhook arrives. This page refreshes automatically.
              </p>
            )}
          {returned === "cancelled" && (
            <p className="notice">
              Checkout was cancelled. You can return whenever you are ready.
            </p>
          )}
          {dataReady && !client && (
            <p className="notice">
              Your account is signed in but has no client-to-Deal mapping. Run
              the seed command or ask the project owner to provision this test
              client.
            </p>
          )}
          <div className="library-grid">
            <article className="document-card">
              <div className="book-art">
                <span className="book-series">
                  FIELDNOTES / PRACTICAL SERIES
                </span>
                <div className="book">
                  <span>
                    THE
                    <br />
                    INTEGRATION
                    <br />
                    <em>PLAYBOOK</em>
                  </span>
                  <div className="book-lines" />
                  <small>PAYMENTS · ACCESS · RESILIENCE</small>
                </div>
                <span className="art-number">VOL. 001</span>
                <span className="format-tag">DIGITAL FIELD GUIDE</span>
              </div>
              <div className="document-info">
                <div className="card-top">
                  <span className="mini-label">ENGINEERING & SYSTEMS</span>
                  <span
                    className={"access-tag " + (entitled ? "unlocked" : "")}
                  >
                    {entitled ? "↗ Unlocked" : "◈ Private access"}
                  </span>
                </div>
                <h2>{document?.title || "The Integration Playbook"}</h2>
                <p>{document?.summary || "Loading your document..."}</p>
                <div className="document-bottom">
                  <div className="price">
                    {document
                      ? new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: document.currency,
                        }).format(document.price_cents / 100)
                      : "$19.00"}
                    <small>ONE-TIME ACCESS</small>
                  </div>
                  {entitled ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const { data, error } = await supabase
                            .from("pac_document_content")
                            .select("content")
                            .eq("document_id", document.id)
                            .single();
                          if (error) throw error;
                          if (activeUser.current === session.user.id)
                            setContent(data.content);
                        })
                      }
                    >
                      Read document ↗
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={busy || !document || !client}
                      onClick={() =>
                        run(async () => {
                          const result = await api("/api/checkout", {
                            documentId: document.id,
                          });
                          location.assign(result.url);
                        })
                      }
                    >
                      {busy ? "Preparing checkout..." : "Unlock document →"}
                    </button>
                  )}
                </div>
              </div>
            </article>
            <aside>
              <section className="status-card">
                <div className="aside-title">
                  <h3>Your access</h3>
                  <span className="live-dot" />
                </div>
                <p className="aside-description">
                  A clear view of your purchase, from checkout to your library.
                </p>
                <div className={"status-step " + (entitled ? "complete" : "")}>
                  <span className="step-number">01</span>
                  <div>
                    <h4>Payment</h4>
                    <p>
                      {paid
                        ? "Confirmed by Stripe"
                        : purchases.length
                          ? "Awaiting payment"
                          : "Ready when you are"}
                    </p>
                  </div>
                  <span>{paid ? "✓" : "—"}</span>
                </div>
                <div className={"status-step " + (entitled ? "complete" : "")}>
                  <span className="step-number">02</span>
                  <div>
                    <h4>Document access</h4>
                    <p>
                      {entitled
                        ? "Granted to your account"
                        : "Locked until payment"}
                    </p>
                  </div>
                  <span>{entitled ? "✓" : "—"}</span>
                </div>
                <div
                  className={
                    "status-step " +
                    (job?.status === "synced" ? "complete" : "")
                  }
                >
                  <span className="step-number">03</span>
                  <div>
                    <h4>CRM sync</h4>
                    <p>
                      {job?.status === "synced"
                        ? "Zoho Deal updated"
                        : job?.status === "processing"
                          ? "Updating Zoho Deal"
                          : job
                            ? "Pending · access is active"
                            : "Starts after purchase"}
                    </p>
                  </div>
                  <span>{job?.status === "synced" ? "✓" : "—"}</span>
                </div>
                {job && job.status !== "synced" && (
                  <>
                    <p className="retry-note">
                      Your document is available while we finish syncing.
                      Attempts: {job.attempts}.
                    </p>
                    <button
                      className="secondary full"
                      disabled={busy || job.status === "processing"}
                      onClick={() =>
                        run(async () => {
                          const result = await api(
                            `/api/purchases/${paid.id}/retry`,
                          );
                          setNotice(
                            result.status === "synced"
                              ? "CRM sync completed."
                              : "Sync requested. Your document access remains active.",
                          );
                          await load();
                        })
                      }
                    >
                      Retry CRM sync ↻
                    </button>
                  </>
                )}
                <button
                  className="text-button refresh"
                  disabled={busy}
                  onClick={() => run(load)}
                >
                  Refresh status ↻
                </button>
              </section>
              <section className="promise">
                <span>◈</span>
                <div>
                  <h4>Made for peace of mind.</h4>
                  <p>
                    One purchase. Your own secure access. Read whenever
                    inspiration calls.
                  </p>
                </div>
              </section>
            </aside>
          </div>
          {purchases.length > 0 && (
            <section className="history">
              <div className="section-heading">
                <h3>Purchase activity</h3>
                <span>YOUR RECORDS ONLY</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>DOCUMENT</th>
                      <th>PURCHASE REFERENCE</th>
                      <th>DATE</th>
                      <th>PAYMENT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id}>
                        <td>The Integration Playbook</td>
                        <td className="mono" title={p.id}>
                          {p.id.slice(0, 8)}...
                        </td>
                        <td>{new Date(p.created_at).toLocaleDateString()}</td>
                        <td>
                          <span className={"payment-tag " + p.status}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      )}
      <footer>
        <span>© 2026 Fieldnotes. A small library for better work.</span>
        <span>
          STRIPE TEST CHECKOUT <b>↗</b> SUPABASE ACCESS <b>↗</b> ZOHO CRM
        </span>
      </footer>
      {content && (
        <div className="modal-backdrop" onClick={() => setContent("")}>
          <section
            className="reader"
            role="dialog"
            aria-modal="true"
            aria-label="Premium document"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="reader-close secondary"
              onClick={() => setContent("")}
            >
              Close document ×
            </button>
            <p className="eyebrow">YOUR UNLOCKED FIELD GUIDE</p>
            {content
              .split("\n")
              .map((line, i) =>
                line.startsWith("# ") ? (
                  <h1 key={i}>{line.slice(2)}</h1>
                ) : line.startsWith("## ") ? (
                  <h2 key={i}>{line.slice(3)}</h2>
                ) : (
                  <p key={i}>{line}</p>
                ),
              )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
