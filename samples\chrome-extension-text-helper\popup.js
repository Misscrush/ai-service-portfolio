document.getElementById("load").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
  document.getElementById("output").value = response?.text || "";
});

