export function logSignalsDemo(label: string, payload?: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  if (payload === undefined) {
    console.log(`[Signals Demo] ${label}`);
    return;
  }

  console.log(`[Signals Demo] ${label}`, payload);
}

export function getInitialDemoMode(search: string) {
  const params = new URLSearchParams(search);
  const demo = params.get("demo");

  return {
    highlight: demo !== "plain",
    panelOpen: demo !== "plain",
  };
}
