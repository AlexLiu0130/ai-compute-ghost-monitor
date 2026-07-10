const layers = ["Hyperscalers", "AI Chips", "HBM / Memory", "Foundry", "Servers", "Power & Cooling"];

const signals = [
  { score: "92", level: "ALERT", time: "08:42", title: "Meta explores selling excess AI compute capacity", type: "Compute overcapacity", move: "NVDA −2.8%", tone: "red" },
  { score: "71", level: "WATCH", time: "07:18", title: "SK Hynix weighs U.S. listing amid AI memory boom", type: "Capital markets", move: "MU +1.4%", tone: "amber" },
  { score: "64", level: "WATCH", time: "06:55", title: "Korea expands semiconductor investment program", type: "Capacity expansion", move: "SOXX +0.9%", tone: "green" },
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Ghost Monitor home"><span className="brandMark">G</span><span>GHOST<br />MONITOR</span></a>
        <div className="navLinks"><a href="#how">How it works</a><a href="#signals">Live signals</a><a href="#coverage">Coverage</a></div>
        <a className="navCta" href="http://127.0.0.1:8765" target="_blank" rel="noreferrer">Open monitor <span>↗</span></a>
      </nav>

      <section className="hero shell" id="top">
        <div className="heroCopy">
          <div className="eyebrow"><span className="pulse" /> AI INFRASTRUCTURE NARRATIVE INTELLIGENCE</div>
          <h1>See the ghost story<br /><em>before the market does.</em></h1>
          <p className="lede">Turn fragmented AI compute news into ranked, explainable market signals—mapped across chips, memory, cloud, power and the entire supply chain.</p>
          <div className="heroActions"><a className="primary" href="#signals">Explore live signals <span>→</span></a><a className="textLink" href="#how">See how scoring works ↓</a></div>
          <div className="trust"><span>TRACKING</span>{["NVDA", "META", "TSM", "MU", "VRT", "+38"].map(x => <b key={x}>{x}</b>)}</div>
        </div>

        <div className="terminal" aria-label="Signal monitor preview">
          <div className="terminalTop"><div><i /><i /><i /></div><span>ghost-monitor / live-feed</span><b>● LIVE</b></div>
          <div className="radar"><span className="radarSweep" /><div className="radarLabel"><small>GHOST SCORE</small><strong>92</strong><span>CRITICAL SIGNAL</span></div></div>
          <div className="terminalStory"><div className="storyMeta"><span>COMPUTE OVERCAPACITY</span><time>08:42:16 UTC</time></div><h3>Hyperscaler explores selling<br />excess AI compute capacity</h3><p>Novel fact changes the expected demand curve for GPU infrastructure.</p></div>
          <div className="tickerTape"><span>IMPACT</span><b className="down">NVDA −2.8%</b><b className="down">SMCI −3.1%</b><b className="mixed">META MIXED</b></div>
        </div>
      </section>

      <section className="stats">
        <div className="shell statsGrid"><div><strong>40+</strong><span>Global tickers</span></div><div><strong>7</strong><span>Supply-chain layers</span></div><div><strong>24/7</strong><span>Narrative monitoring</span></div><div><strong>&lt;5m</strong><span>Signal latency</span></div></div>
      </section>

      <section className="section shell" id="how">
        <div className="sectionHead"><div><span className="kicker">THE JUDGMENT ENGINE</span><h2>News is noise.<br />Direction is intelligence.</h2></div><p>Every story passes through a transparent five-factor model, then maps to the companies and layers it actually affects.</p></div>
        <div className="steps">
          <article><span>01</span><div className="stepIcon">⌁</div><h3>Capture</h3><p>Continuously scan authoritative reporting, company disclosures and market sources.</p></article>
          <article><span>02</span><div className="stepIcon">◎</div><h3>Score</h3><p>Measure credibility, novelty, theme strength, contagion and price confirmation.</p></article>
          <article><span>03</span><div className="stepIcon">↗</div><h3>Map impact</h3><p>Translate narrative—not sentiment—into direction for each exposed layer.</p></article>
          <article><span>04</span><div className="stepIcon">◫</div><h3>Confirm</h3><p>Validate against single-name moves, baskets, ETFs, volume and optional flow.</p></article>
        </div>
      </section>

      <section className="signalSection" id="signals">
        <div className="shell">
          <div className="sectionHead light"><div><span className="kicker">LATEST SIGNALS</span><h2>A live read on the<br />AI compute narrative.</h2></div><div className="legend"><span><i className="dot red" /> Alert 60+</span><span><i className="dot amber" /> Watch 20–59</span></div></div>
          <div className="signalTable">
            <div className="signalHeader"><span>SCORE</span><span>SIGNAL</span><span>NARRATIVE</span><span>MARKET READ</span></div>
            {signals.map(s => <article className="signalRow" key={s.title}>
              <div className={`score ${s.tone}`}><strong>{s.score}</strong><span>{s.level}</span></div>
              <div className="signalTitle"><time>{s.time} UTC</time><h3>{s.title}</h3></div>
              <div className="tag">{s.type}</div><div className={`market ${s.tone}`}>{s.move}</div>
            </article>)}
          </div>
          <p className="disclaimer">Illustrative signals based on project case studies. Research tool only—not investment advice.</p>
        </div>
      </section>

      <section className="coverage section shell" id="coverage">
        <div className="coverageCopy"><span className="kicker">FULL-STACK COVERAGE</span><h2>One story.<br />Every exposed layer.</h2><p>A GPU order cut is not just a chip story. Ghost Monitor traces the second- and third-order impact across buyers, suppliers, infrastructure and market proxies.</p><a className="textLink dark" href="#signals">View the signal map →</a></div>
        <div className="layerMap">{layers.map((x,i) => <div key={x}><span>0{i+1}</span><b>{x}</b><em>{["META · MSFT · GOOGL · AMZN", "NVDA · AMD · AVGO · ANET", "MU · SK HYNIX · SAMSUNG", "TSM · ASML · AMAT · LRCX", "SMCI · DELL · HPE", "VRT · ETN · CEG · PWR"][i]}</em></div>)}</div>
      </section>

      <section className="cta"><div className="shell"><span className="kicker">FROM HEADLINE TO EXPOSURE MAP</span><h2>Stop tracking news.<br /><em>Start tracking narrative risk.</em></h2><a className="primary lightBtn" href="http://127.0.0.1:8765" target="_blank" rel="noreferrer">Launch Ghost Monitor <span>↗</span></a></div></section>
      <footer className="footer shell"><div className="brand"><span className="brandMark">G</span><span>GHOST<br />MONITOR</span></div><p>AI compute narrative intelligence.<br />Built for research, not prediction.</p><span>© 2026 · MIT LICENSE</span></footer>
    </main>
  );
}
