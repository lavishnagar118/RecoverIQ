import { useEffect, useMemo, useState } from "react";

interface RecoverySummary {
  datasetType: "synthetic";
  seed: number;
  totalCases: number;
  totalAmountAtRisk: number;
  averageAmountAtRisk: number;
  numberOfRecoverableCases: number;
  totalExpectedRecoveryValue: number;
  statusDistribution: Record<string, number>;
}

const emptySummaryItems = [
  {
    label: "Cases",
    value: "Loading",
    status: "Synthetic"
  },
  {
    label: "Amount at Risk",
    value: "Loading",
    status: "Synthetic"
  },
  {
    label: "Expected Recovery",
    value: "Loading",
    status: "Baseline"
  },
  {
    label: "Recoverable Cases",
    value: "Loading",
    status: "Baseline"
  }
];

const navigationItems = ["Dashboard", "Recovery Cases", "Policies", "Audit Trail"];

const formatCurrency = (amountInPaise: number): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amountInPaise / 100);

function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const [summary, setSummary] = useState<RecoverySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/recovery/summary`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Recovery summary request failed with ${response.status}`);
        }

        const data = (await response.json()) as RecoverySummary;
        setSummary(data);
        setErrorMessage(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Recovery summary request failed");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadSummary();

    return () => controller.abort();
  }, [apiBaseUrl]);

  const summaryItems = useMemo(() => {
    if (!summary) {
      return emptySummaryItems;
    }

    return [
      {
        label: "Cases",
        value: summary.totalCases.toLocaleString("en-IN"),
        status: "Synthetic"
      },
      {
        label: "Amount at Risk",
        value: formatCurrency(summary.totalAmountAtRisk),
        status: "Synthetic"
      },
      {
        label: "Expected Recovery",
        value: formatCurrency(summary.totalExpectedRecoveryValue),
        status: "Baseline"
      },
      {
        label: "Recoverable Cases",
        value: summary.numberOfRecoverableCases.toLocaleString("en-IN"),
        status: "Baseline"
      }
    ];
  }, [summary]);

  const statusRows = summary
    ? Object.entries(summary.statusDistribution).filter(([, count]) => count > 0)
    : [];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span>RecoverIQ</span>
        </div>
        <nav className="nav-list">
          {navigationItems.map((item) => (
            <a className={item === "Dashboard" ? "active" : ""} href="/" key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">Milestone 2</p>
            <h1>Revenue Recovery Dashboard</h1>
          </div>
          <span className="status-pill">Synthetic Baseline</span>
        </header>

        <section className="summary-grid" aria-label="Synthetic recovery summary">
          {summaryItems.map((item) => (
            <article className="summary-card" key={item.label}>
              <div>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </div>
              <span>{item.status}</span>
            </article>
          ))}
        </section>

        {isLoading ? <p className="notice">Loading synthetic recovery summary.</p> : null}
        {errorMessage ? <p className="notice error">{errorMessage}</p> : null}

        <section className="workspace-panel">
          <div>
            <p className="eyebrow">Development API</p>
            <h2>{apiBaseUrl || "same-origin"}/api/recovery/summary</h2>
            <p className="panel-copy">
              Synthetic evaluation only. These values are deterministic baseline estimates, not real
              merchant recovery results.
            </p>
          </div>
          <div className="scope-list" aria-label="V1 scope">
            <span>Failed payment recovery</span>
            <span>Checkout abandonment recovery</span>
          </div>
        </section>

        <section className="status-panel" aria-label="Recovery status counts">
          <div>
            <p className="eyebrow">Status Counts</p>
            <h2>Current Synthetic Batch</h2>
          </div>
          <div className="status-grid">
            {statusRows.map(([status, count]) => (
              <div className="status-row" key={status}>
                <span>{status.replaceAll("_", " ")}</span>
                <strong>{count.toLocaleString("en-IN")}</strong>
              </div>
            ))}
            {!summary && !isLoading ? <p className="notice">No summary data available.</p> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
