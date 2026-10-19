/// <reference types="chrome" />

// The options page (also the toolbar popup — manifest.json points both
// `options_page` and `action.default_popup` at this same file) runs as a
// genuine extension page, not a content script injected into a third-party
// site — so, unlike content-isolated.ts/content-main.ts, it can fetch the
// Unfold server directly: an extension page's own requests aren't subject
// to any site's CSP/CORS, only to whatever host permissions this extension
// itself holds. That's why "connect" below calls `fetch` straight from
// here rather than routing through background.ts's message handler.

interface StoredConfig {
  serverUrl?: string;
  apiToken?: string;
}

const connectForm = document.getElementById("connect-form") as HTMLFormElement;
const serverUrlInput = document.getElementById(
  "server-url",
) as HTMLInputElement;
const apiTokenInput = document.getElementById("api-token") as HTMLInputElement;
const connectButton = document.getElementById(
  "connect-button",
) as HTMLButtonElement;
const disconnectButton = document.getElementById(
  "disconnect-button",
) as HTMLButtonElement;
const connectStatus = document.getElementById(
  "connect-status",
) as HTMLDivElement;
const siteForm = document.getElementById("site-form") as HTMLFormElement;
const siteUrlInput = document.getElementById("site-url") as HTMLInputElement;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const siteEmpty = document.getElementById("site-empty") as HTMLParagraphElement;

function setStatus(
  el: HTMLElement,
  message: string,
  kind: "ok" | "error" | "" = "",
) {
  el.textContent = message;
  el.className = kind ? `status ${kind}` : "";
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

async function loadConfig(): Promise<void> {
  const { serverUrl, apiToken }: StoredConfig = await chrome.storage.local.get([
    "serverUrl",
    "apiToken",
  ]);
  if (serverUrl) serverUrlInput.value = serverUrl;
  if (apiToken) apiTokenInput.value = apiToken;
  setStatus(
    connectStatus,
    serverUrl && apiToken ? `Connected to ${serverUrl}` : "Not connected yet.",
    serverUrl && apiToken ? "ok" : "",
  );
}

connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const serverUrl = serverUrlInput.value.trim().replace(/\/$/, "");
  const apiToken = apiTokenInput.value.trim();
  const origin = originOf(serverUrl);
  if (!origin) {
    setStatus(connectStatus, "Enter a valid server URL.", "error");
    return;
  }
  connectButton.disabled = true;
  setStatus(connectStatus, "Connecting…");
  try {
    const granted = await chrome.permissions.request({
      origins: [`${origin}/*`],
    });
    if (!granted) {
      setStatus(
        connectStatus,
        "Permission to reach that server was not granted.",
        "error",
      );
      return;
    }
    const response = await fetch(`${serverUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!response.ok) {
      setStatus(
        connectStatus,
        response.status === 401
          ? "That token was rejected. Create a new one in Unfold's Settings → Extensions."
          : `Could not connect (HTTP ${response.status}).`,
        "error",
      );
      return;
    }
    await chrome.storage.local.set({ serverUrl, apiToken });
    setStatus(connectStatus, `Connected to ${serverUrl}`, "ok");
  } catch (error) {
    setStatus(
      connectStatus,
      error instanceof Error ? error.message : "Could not reach that server.",
      "error",
    );
  } finally {
    connectButton.disabled = false;
  }
});

disconnectButton.addEventListener("click", async () => {
  const { serverUrl }: StoredConfig = await chrome.storage.local.get([
    "serverUrl",
  ]);
  await chrome.storage.local.remove(["serverUrl", "apiToken"]);
  const origin = serverUrl ? originOf(serverUrl) : undefined;
  if (origin) await chrome.permissions.remove({ origins: [`${origin}/*`] });
  serverUrlInput.value = "";
  apiTokenInput.value = "";
  setStatus(connectStatus, "Disconnected.");
});

async function refreshSiteList(): Promise<void> {
  const { serverUrl }: StoredConfig = await chrome.storage.local.get([
    "serverUrl",
  ]);
  const serverOrigin = serverUrl ? originOf(serverUrl) : undefined;
  const granted = await chrome.permissions.getAll();
  const origins = (granted.origins ?? [])
    .map((pattern) => pattern.replace(/\/\*$/, ""))
    .filter((pattern) => {
      const patternOrigin = originOf(pattern) ?? pattern;
      return patternOrigin !== serverOrigin;
    });

  siteList.innerHTML = "";
  siteEmpty.style.display = origins.length ? "none" : "block";
  for (const origin of origins) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = origin;
    const removeButton = document.createElement("button");
    removeButton.className = "secondary";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      await chrome.permissions.remove({ origins: [`${origin}/*`] });
      await refreshSiteList();
    });
    li.append(span, removeButton);
    siteList.appendChild(li);
  }
}

siteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const origin = originOf(siteUrlInput.value.trim());
  if (!origin) return;
  const granted = await chrome.permissions.request({
    origins: [`${origin}/*`],
  });
  if (granted) {
    siteUrlInput.value = "";
    await refreshSiteList();
  }
});

void loadConfig();
void refreshSiteList();
