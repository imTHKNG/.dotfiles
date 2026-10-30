// Commands supported by herdr-app, including the old prefix defaults.
export const prefixBindings = {
  v: ["pane.split", { direction: "right" }],
  "|": ["pane.split", { direction: "right" }],
  "-": ["pane.split", { direction: "down" }],
  q: ["window.close"],
  d: ["window.close"],
  ";": ["app.settings"],
  a: ["agent.next"],
  A: ["agent.prev"],
  h: ["pane.go", { direction: "left" }],
  j: ["pane.go", { direction: "down" }],
  k: ["pane.go", { direction: "up" }],
  l: ["pane.go", { direction: "right" }],
  c: ["tab.new"],
  n: ["tab.next"],
  p: ["tab.prev"],
  T: ["tab.rename"],
  X: ["tab.close"],
  N: ["space.new"],
  W: ["space.rename"],
  D: ["space.close"],
  x: ["pane.close"],
  z: ["pane.zoom"],
  b: ["layout.toggle", { id: "sidebar" }],
  "?": ["app.help"],
};

export function prefixAction(event) {
  const m = event.modifiers;
  if (m.control || m.alt || m.platform) return null;
  let key = event.key_char || event.key;
  if (key.length === 1 && m.shift) key = key.toUpperCase();
  if (key === "w" || key === "s") return ["picker"];
  if (/^[1-9]$/.test(key)) return ["tab.select", { index: Number(key) }];
  return prefixBindings[key] ?? null;
}

export function stepIndex(index, delta, length) {
  return length ? (index + delta + length) % length : 0;
}
