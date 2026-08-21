const foundationItems = [
  {
    label: "Backend API",
    value: "/api/health",
    status: "Ready"
  },
  {
    label: "MongoDB Layer",
    value: "Configured on demand",
    status: "Ready"
  },
  {
    label: "Recovery Logic",
    value: "Future milestone",
    status: "Not started"
  }
];

const navigationItems = ["Dashboard", "Recovery Cases", "Policies", "Audit Trail"];

function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

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
            <p className="eyebrow">Milestone 1</p>
            <h1>Revenue Recovery Dashboard</h1>
          </div>
          <span className="status-pill">Foundation</span>
        </header>

        <section className="summary-grid" aria-label="Foundation status">
          {foundationItems.map((item) => (
            <article className="summary-card" key={item.label}>
              <div>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </div>
              <span>{item.status}</span>
            </article>
          ))}
        </section>

        <section className="workspace-panel">
          <div>
            <p className="eyebrow">Backend Health</p>
            <h2>{apiBaseUrl}/api/health</h2>
          </div>
          <div className="scope-list" aria-label="V1 scope">
            <span>Failed payment recovery</span>
            <span>Checkout abandonment recovery</span>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
