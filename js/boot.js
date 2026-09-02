/**
 * Cinematic initialization sequence.
 * Models load in parallel; the CTA unlocks when the vision engine is ready.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setBar(pct) {
  const el = document.getElementById("boot-bar");
  if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

export async function playBootSequence() {
  const kicker = document.querySelector("[data-boot='kicker']");
  const title = document.querySelector("[data-boot='title']");
  const subtitle = document.querySelector("[data-boot='subtitle']");
  const rule = document.querySelector("[data-boot='rule']");
  const bar = document.querySelector("[data-boot='bar']");
  const privacy = document.querySelector(".boot__privacy");
  const status = document.getElementById("boot-status");

  const fade = (el, delay = 0) => {
    if (!el) return;
    el.style.transition = "opacity 0.7s ease";
    el.style.transitionDelay = `${delay}ms`;
    el.style.opacity = "1";
  };

  fade(kicker, 80);
  fade(title, 220);
  fade(subtitle, 480);
  await sleep(520);
  if (rule) {
    rule.style.transition = "width 0.8s ease, opacity 0.4s ease";
    rule.style.opacity = "0.7";
    rule.style.width = "120px";
  }
  fade(bar, 0);
  fade(privacy, 400);
  setBar(8);
  status.textContent = "INITIALIZING…";
}

export function setBootProgress(pct, message) {
  setBar(pct);
  if (message) {
    document.getElementById("boot-status").textContent = message;
  }
}

export function logBoot(line) {
  const list = document.getElementById("boot-log");
  const li = document.createElement("li");
  li.textContent = line;
  list.appendChild(li);
}

export function unlockStart() {
  const btn = document.getElementById("start-btn");
  btn.disabled = false;
  document.getElementById("boot-status").textContent = "AWAITING OPERATOR";
}

export function dismissBoot() {
  const boot = document.getElementById("boot");
  boot.classList.add("is-leaving");
  return new Promise((resolve) => {
    setTimeout(() => {
      boot.hidden = true;
      resolve();
    }, 680);
  });
}
