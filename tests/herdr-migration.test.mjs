import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { prefixAction, stepIndex } from "../home/dot_config/herdr-app/mods/legacy-keys/bindings.js";

const root = new URL("../home/dot_config/herdr-app/", import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const event = (key, modifiers = {}, key_char) => ({
  key, key_char,
  modifiers: { control: false, alt: false, platform: false, shift: false, ...modifiers },
});

// Exercise interaction logic without sending keys to the user's window.
function harness() {
  const calls = [];
  const model = {
    spaces: [
      { id: "s1", name: "one", active: true, tabs: [{ id: "t1", index: 1, name: "1", active: true }] },
      { id: "s2", name: "two", tabs: [{ id: "t2", index: 1, name: "1", active: true }, { id: "t3", index: 2, name: "2" }] },
    ],
    panes: [{ tab: "t1", pane: "p1", focused: true }, { tab: "t2", pane: "p2" }, { tab: "t2", pane: "p3" }],
  };
  const ui = () => new Proxy({}, { get: () => (..._args) => ui() });
  const cx = { focus_handle: () => ({ focus() {} }), stop_propagation() {}, notify() {} };
  const source = readFileSync(new URL("mods/legacy-keys/main.js", root), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export default class", "return class");
  const factory = new Function("View", "div", "v_flex", "spaces", "panes", "focused", "run", "theme", "props", "closeOverlay", "prefixAction", "stepIndex", source);
  const Mod = factory(class {}, ui, ui, () => model.spaces, () => model.panes,
    () => ({ space: "s1", tab: "t1", pane: "p1" }),
    (...args) => calls.push(args), () => ({}), () => ({ overlay: "test" }),
    id => calls.push(["close", id]), prefixAction, stepIndex);
  const mod = new Mod();
  mod.init({}, cx);
  return { mod, model, calls, key: (...args) => mod.key(event(...args), cx) };
}

test("every configured prefix action keeps its command and aliases", () => {
  for (const [keys, expected] of [
    [["v", "|"], ["pane.split", { direction: "right" }]],
    [["q", "d"], ["window.close"]],
    [["w", "s"], ["picker"]],
    [[";"], ["app.settings"]],
    [["a"], ["agent.next"]],
    [["h"], ["pane.go", { direction: "left" }]],
    [["j"], ["pane.go", { direction: "down" }]],
    [["k"], ["pane.go", { direction: "up" }]],
    [["l"], ["pane.go", { direction: "right" }]],
  ]) for (const key of keys) assert.deepEqual(prefixAction(event(key)), expected);
  assert.deepEqual(prefixAction(event("a", { shift: true })), ["agent.prev"]);
  assert.deepEqual(prefixAction(event("a", { shift: true }, "A")), ["agent.prev"]);
  assert.deepEqual(prefixAction(event("\\", { shift: true }, "|")), ["pane.split", { direction: "right" }]);
});

test("modified and unknown keys never run prefix commands", () => {
  for (const modifier of ["control", "alt", "platform"])
    assert.equal(prefixAction(event("q", { [modifier]: true })), null);
  assert.equal(prefixAction(event("f12")), null);
});

test("common old defaults remain available", () => {
  assert.deepEqual(prefixAction(event("c")), ["tab.new"]);
  assert.deepEqual(prefixAction(event("9")), ["tab.select", { index: 9 }]);
  assert.deepEqual(prefixAction(event("-")), ["pane.split", { direction: "down" }]);
});

test("picker uses j/k for spaces and arrows for panes without changing live focus", () => {
  const { mod, calls, key } = harness();
  key("w");
  assert.equal(mod.mode, "picker");
  key("j");
  assert.equal(mod.selection().space.id, "s2");
  assert.equal(mod.selection().pane.pane, "p2");
  key("down");
  assert.equal(mod.selection().pane.pane, "p3");
  key("up");
  assert.equal(mod.selection().pane.pane, "p2");
  assert.deepEqual(calls, []);
  key("enter");
  assert.deepEqual(calls, [["close", "test"], ["space.select", { id: "s2" }], ["tab.select", { id: "t2" }], ["pane.focus", { pane: "p2" }]]);
});

test("picker wraps spaces and supports tabs, empty panes and cancellation", () => {
  const { mod, model, calls, key } = harness();
  key("s");
  key("k");
  assert.equal(mod.selection().space.id, "s2");
  key("tab");
  assert.equal(mod.selection().tab.id, "t3");
  key("down");
  assert.equal(mod.selection().pane, undefined);
  key("tab", { shift: true });
  assert.equal(mod.selection().tab.id, "t2");
  key("2");
  assert.equal(mod.selection().tab.id, "t3");
  model.spaces = [];
  model.panes = [];
  key("j");
  mod.render();
  key("escape");
  assert.deepEqual(calls, [["close", "test"]]);
  assert.equal(stepIndex(0, -1, 2), 1);
  assert.equal(stepIndex(0, 1, 0), 0);
});

test("prefix commands close their overlay before running; Escape only closes", () => {
  const first = harness();
  first.mod.render();
  first.key("v");
  assert.deepEqual(first.calls, [["close", "test"], ["pane.split", { direction: "right" }]]);
  const second = harness();
  second.key("escape");
  assert.deepEqual(second.calls, [["close", "test"]]);
});

test("settings, direct bindings, themes and personal layout migrate correctly", () => {
  const settings = json("settings.json");
  assert.equal(settings.sounds.enabled, false);
  assert.deepEqual(settings.theme, { light: "catppuccin-latte", dark: "catppuccin" });
  assert.equal(settings.zoom, 1.1);
  assert.equal(settings.appearance, undefined);
  const keys = json("keys.json");
  assert.equal(keys.global["ctrl-b"], "mod.open:legacy-keys");
  for (const [key, direction] of Object.entries({ h: "left", j: "down", k: "up", l: "right" }))
    assert.equal(keys.terminal[`ctrl-${key}`], `pane.go:${direction}`);
  assert.equal(keys.global["ctrl-shift-t"], "tab.new");
  const layout = json("layouts/knth.json");
  const work = layout.children.find(n => n.id === "work");
  assert.deepEqual(work.children.map(n => n.id), ["tabs", "work-body", "status"]);
  assert.equal(layout.cloned_from.name, "main");
  for (const name of Object.values(settings.theme)) {
    const theme = json(`themes/${name}.json`);
    assert.equal(theme.ansi.length, 16);
    for (const color of [theme.background, theme.foreground, theme.selection, theme.cursor, ...theme.ansi, ...Object.values(theme.colors)])
      assert.match(color, /^#[\da-f]{6}$/i);
  }
});
