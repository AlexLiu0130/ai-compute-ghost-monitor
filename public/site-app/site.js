"use strict";

const lang = localStorage.getItem("ghost-lang") || "zh";
const githubRepo = "AlexLiu0130/ai-compute-ghost-monitor";

function applyLanguage(next) {
  localStorage.setItem("ghost-lang", next);
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  const path = location.pathname.replace(/\/$/, "");
  const developer = path.endsWith("/developer") || path.endsWith("/developer.html");
  document.title = developer
    ? (next === "zh" ? "开发者 — Ghost Monitor × QVeris" : "Developers — Ghost Monitor × QVeris")
    : (next === "zh" ? "Ghost Monitor — AI 算力叙事监控" : "Ghost Monitor — AI Compute Narrative Intelligence");
  document.querySelectorAll("[data-zh][data-en]").forEach((node) => {
    node.innerHTML = node.dataset[next];
  });
  document.querySelectorAll(".language-toggle").forEach((button) => {
    button.textContent = next === "zh" ? "EN" : "中文";
    button.setAttribute("aria-label", next === "zh" ? "Switch to English" : "切换到中文");
  });
  document.querySelectorAll(".github-star").forEach((link) => {
    link.title = next === "zh" ? "前往 GitHub 为项目点 Star" : "Open GitHub and star this repository";
  });
}

async function loadGitHubStars() {
  const counters = document.querySelectorAll("[data-star-count]");
  if (!counters.length) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const repository = await response.json();
    const count = Number(repository.stargazers_count);
    if (!Number.isFinite(count)) return;
    counters.forEach((counter) => { counter.textContent = count.toLocaleString(); });
  } catch (error) {
    console.warn("Unable to load GitHub star count", error);
  }
}

function setupAgentMotion() {
  const section = document.querySelector(".agent-architecture");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!section || reducedMotion.matches || !("IntersectionObserver" in window)) return;

  section.classList.add("motion-ready");
  const observer = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting) return;
    section.classList.add("is-active");
    observer.disconnect();
  }, { threshold: 0.24 });
  observer.observe(section);
}

applyLanguage(lang);
document.querySelectorAll(".language-toggle").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(localStorage.getItem("ghost-lang") === "zh" ? "en" : "zh"));
});
loadGitHubStars();
setupAgentMotion();
