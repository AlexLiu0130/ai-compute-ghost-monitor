"use strict";

const lang = localStorage.getItem("ghost-lang") || "zh";

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
}

applyLanguage(lang);
document.querySelectorAll(".language-toggle").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(localStorage.getItem("ghost-lang") === "zh" ? "en" : "zh"));
});
