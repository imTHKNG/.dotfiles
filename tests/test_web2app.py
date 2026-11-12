#!/usr/bin/env python3

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest


ROOT = Path(__file__).parents[1]
FUNCTIONS = ROOT / "home" / "dot_config" / "fish" / "functions"
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def render(template: Path) -> str:
    return "".join(
        line
        for line in template.read_text().splitlines(keepends=True)
        if not line.lstrip().startswith("{{")
    )


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


class Web2AppTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.data = self.home / ".local" / "share"
        self.applications = self.data / "applications"
        self.icons = self.data / "icons" / "hicolor" / "256x256" / "apps"
        self.bin = self.root / "bin"
        self.functions = self.root / "functions"

        self.home.mkdir()
        self.bin.mkdir()
        self.functions.mkdir()

        for name in ("update-desktop-database", "gtk-update-icon-cache", "kbuildsycoca6"):
            stub = self.bin / name
            stub.write_text("#!/bin/sh\nexit 0\n")
            stub.chmod(0o755)

        for name in ("web2app", "web2app-remove"):
            (self.functions / f"{name}.fish").write_text(render(FUNCTIONS / f"{name}.fish.tmpl"))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def fish(self, *args: str) -> subprocess.CompletedProcess[str]:
        environment = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "LANG": "C.UTF-8",
        }
        command = f"set -p fish_function_path {self.functions}; " + " ".join(
            ["$argv[1]", *[f"$argv[{index}]" for index in range(2, len(args) + 1)]]
        )

        return subprocess.run(
            ["fish", "--no-config", "-c", command, *args],
            capture_output=True,
            env=environment,
            text=True,
            timeout=20,
        )

    def entry(self, name: str) -> dict[str, str]:
        lines = (self.applications / f"{name}.desktop").read_text().splitlines()

        return dict(line.split("=", 1) for line in lines[1:])

    def serve(self, files: dict[str, bytes]) -> str:
        site = self.root / "site"
        site.mkdir()
        for name, content in files.items():
            (site / name).write_bytes(content)

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=site))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        return f"http://127.0.0.1:{server.server_port}"

    def test_creates_valid_kde_launcher_from_local_icon(self) -> None:
        icon = self.root / "WhatsApp.png"
        icon.write_bytes(PNG)

        result = self.fish("web2app", "WhatsApp", "web.whatsapp.com", str(icon))

        self.assertEqual(result.returncode, 0, result.stderr)
        entry = self.entry("WhatsApp")
        self.assertEqual(
            entry["Exec"],
            'chromium --new-window "--app=https://web.whatsapp.com" "--name=WhatsApp" "--class=WhatsApp"',
        )
        self.assertEqual(entry["Icon"], "whatsapp")
        self.assertEqual(entry["StartupWMClass"], "chrome-web.whatsapp.com__-Default")
        self.assertEqual(entry["X-Web2App"], "true")
        self.assertEqual((self.icons / "whatsapp.png").read_bytes(), PNG)
        if shutil.which("desktop-file-validate"):
            validation = subprocess.run(
                ["desktop-file-validate", str(self.applications / "WhatsApp.desktop")],
                capture_output=True,
                text=True,
            )
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

    def test_fetches_site_icon_when_icon_is_omitted(self) -> None:
        origin = self.serve(
            {
                "index.html": b'<html><head><link rel="apple-touch-icon" href="/touch.png"></head></html>',
                "touch.png": PNG,
            }
        )

        result = self.fish("web2app", "Local App", f"{origin}/index.html")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.entry("Local App")["Icon"], "local-app")
        self.assertEqual((self.icons / "local-app.png").read_bytes(), PNG)

    def test_escapes_url_inside_exec(self) -> None:
        result = self.fish("web2app", "Escaped", "https://example.test/a%20b?q=$HOME", "whatsapp")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"--app=https://example.test/a%%20b?q=\\\\$HOME"', self.entry("Escaped")["Exec"])

    def test_rejects_unsafe_names_and_urls(self) -> None:
        cases = [
            ("../Escape", "https://example.test", "whatsapp"),
            ("Bad\nName", "https://example.test", "whatsapp"),
            ("Script", "javascript:alert(1)", "whatsapp"),
            ("Spaces", "https://example.test/a b", "whatsapp"),
        ]

        for case in cases:
            with self.subTest(case=case):
                result = self.fish("web2app", *case)
                self.assertNotEqual(result.returncode, 0)

        self.assertEqual(list(self.applications.glob("*.desktop")) if self.applications.exists() else [], [])

    def test_removes_new_and_legacy_launchers_with_their_icons(self) -> None:
        icon = self.root / "new.png"
        icon.write_bytes(PNG)
        self.assertEqual(self.fish("web2app", "New App", "https://new.test", str(icon)).returncode, 0)
        legacy_icon = self.applications / "icons" / "Legacy.png"
        legacy_icon.parent.mkdir(parents=True)
        legacy_icon.write_bytes(PNG)
        (self.applications / "Legacy.desktop").write_text(
            "[Desktop Entry]\nType=Application\nName=Legacy\n"
            f'Exec=chromium --new-window --app="https://legacy.test"\nIcon={legacy_icon}\n'
        )

        listed = self.fish("web2app-remove")
        removed_new = self.fish("web2app-remove", "New App")
        removed_legacy = self.fish("web2app-remove", "Legacy")

        self.assertEqual(listed.stdout.splitlines(), ["Legacy", "New App"])
        self.assertEqual(removed_new.returncode, 0, removed_new.stderr)
        self.assertEqual(removed_legacy.returncode, 0, removed_legacy.stderr)
        self.assertFalse((self.applications / "New App.desktop").exists())
        self.assertFalse((self.icons / "new-app.png").exists())
        self.assertFalse((self.applications / "Legacy.desktop").exists())
        self.assertFalse(legacy_icon.exists())

    def test_refuses_to_remove_regular_launcher(self) -> None:
        self.applications.mkdir(parents=True)
        launcher = self.applications / "Editor.desktop"
        launcher.write_text("[Desktop Entry]\nType=Application\nName=Editor\nExec=editor\n")

        result = self.fish("web2app-remove", "Editor")

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(launcher.exists())


if __name__ == "__main__":
    unittest.main()
