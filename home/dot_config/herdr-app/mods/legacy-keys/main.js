import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, panes, focused, run, theme, props, closeOverlay } from "herdr";
import { prefixAction, stepIndex } from "./bindings.js";

// No exec, filesystem access, network access or background polling.
export default class LegacyKeys extends View {
  init(_props, cx) {
    this.mode = "prefix";
    this.space = focused()?.space;
    this.tab = focused()?.tab;
    this.pane = focused()?.pane;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  selection() {
    const all = spaces();
    const space = all.find(s => s.id === this.space) ?? all.find(s => s.active) ?? all[0];
    const tabs = space?.tabs ?? [];
    const tab = tabs.find(t => t.id === this.tab) ?? tabs.find(t => t.active) ?? tabs[0];
    const list = panes().filter(p => p.tab === tab?.id);
    const pane = list.find(p => p.pane === this.pane) ?? list.find(p => p.focused) ?? list[0];
    return { all, space, tabs, tab, list, pane };
  }

  choose() {
    const { space, tab, pane } = this.selection();
    this.dismiss();
    if (!space) return;
    run("space.select", { id: space.id });
    if (tab) run("tab.select", { id: tab.id });
    if (pane) run("pane.focus", { pane: pane.pane });
  }

  key(event, cx) {
    cx.stop_propagation();
    if (event.key === "escape") return this.dismiss();
    if (this.mode === "prefix") {
      const action = prefixAction(event);
      if (action?.[0] === "picker") {
        this.mode = "picker";
        cx.notify();
      } else {
        this.dismiss();
        if (action) run(...action);
      }
      return;
    }
    const m = event.modifiers;
    if (m.control || m.alt || m.platform) return;
    if (event.key === "enter") return this.choose();
    const { all, space, tabs, tab, list, pane } = this.selection();
    if (event.key === "j" || event.key === "k") {
      const next = stepIndex(all.indexOf(space), event.key === "j" ? 1 : -1, all.length);
      this.space = all[next]?.id;
      this.tab = null;
      this.pane = null;
    } else if (event.key === "tab") {
      this.tab = tabs[stepIndex(tabs.indexOf(tab), m.shift ? -1 : 1, tabs.length)]?.id;
      this.pane = null;
    } else if (event.key === "down" || event.key === "up") {
      const next = stepIndex(list.indexOf(pane), event.key === "down" ? 1 : -1, list.length);
      this.pane = list[next]?.pane;
    } else if (/^[1-9]$/.test(event.key)) {
      this.tab = tabs[Number(event.key) - 1]?.id ?? tab?.id;
      this.pane = null;
    } else return;
    cx.notify();
  }

  render() {
    const t = theme();
    const root = v_flex().id("legacy-keys").track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .w_full().p(18).gap(10).bg(t.popover).text_size(13).text_color(t.foreground);
    if (this.mode === "prefix") {
      return root
        .child(div().font_semibold().child("Ctrl+B"))
        .child(div().child("v / | split · h j k l focus · a / Shift+A agents"))
        .child(div().child("w / s spaces · ; settings · q / d detach"))
        .child(div().text_color(t.dim).child("c new tab · n / p tabs · x close pane · z zoom · Esc cancel"));
    }
    const { all, space, tabs, tab, list, pane } = this.selection();
    const row = (id, label, selected, click) => div().id(id).px(10).py(6).rounded(6)
      .when(selected, el => el.bg(t.selected)).hover(el => el.bg(t.hover))
      .cursor_pointer().on_click(click).truncate().child(label);
    return root
      .child(div().font_semibold().child("Spaces and panes"))
      .child(div().text_color(t.dim).child("j / k spaces · Tab / Shift+Tab tabs · ↑ / ↓ panes · Enter select · Esc cancel"))
      .child(v_flex().max_h(240).overflow_y_scrollbar().children(all.map(s =>
        row(`space-${s.id}`, s.name, s.id === space?.id, (_event, cx) => {
          this.space = s.id;
          this.tab = null;
          this.pane = null;
          cx.notify();
        }))))
      .child(div().text_color(t.muted).child(tabs.map(item => `${item.id === tab?.id ? "> " : ""}${item.index}: ${item.name}`).join("   ")))
      .child(v_flex().max_h(180).overflow_y_scrollbar().children(list.map(p =>
        row(`pane-${p.pane}`, p.title || p.terminal || p.mod || p.pane, p.pane === pane?.pane, () => {
          this.pane = p.pane;
          this.choose();
        }))))
      .when(!all.length, el => el.child("No spaces open"));
  }
}
