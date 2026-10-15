import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "home/dot_local/bin/executable_cli-proxy-setup"
MANAGED = REPO / "home/dot_config/cli-proxy-api"


class CliProxySetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.managed = self.home / ".config/cli-proxy-api"
        shutil.copytree(MANAGED, self.managed)
        self.root = self.home / ".local/share/cliproxyapi-opus-test"
        self.models = self.home / ".pi/agent/models.json"

    def run_setup(self, *args, success=True):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            env={"HOME": str(self.home), "PATH": os.defpath},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result

    def test_fresh_machine_gets_private_config_and_provider_without_printing_key(self):
        result = self.run_setup()
        key = (self.root / "proxy-key").read_text().strip()
        config = (self.root / "config.native.yaml").read_text()
        self.assertEqual(len(key), 64)
        self.assertIn(key, config)
        self.assertIn('host: "127.0.0.1"', config)
        self.assertIn(str(self.root / "auth-native"), config)
        self.assertNotIn("__AUTH_DIR__", config)
        self.assertNotIn(key, result.stdout + result.stderr)
        for name in ("proxy-key", "config.native.yaml"):
            self.assertEqual(stat.S_IMODE((self.root / name).stat().st_mode), 0o600)
        for path in (self.root, self.root / "auth-native"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
        provider = json.loads(self.models.read_text())["providers"]["claude-pro-proxy"]
        self.assertTrue(provider["apiKey"].startswith("!python3 "))
        self.assertNotIn(key, self.models.read_text())

    def test_existing_settings_and_oauth_are_preserved_on_repeat(self):
        self.run_setup()
        config = self.root / "config.native.yaml"
        config.write_text(config.read_text() + "# machine-local customization\n")
        auth = self.root / "auth-native/account.json"
        auth.write_text('{"fake_token": "do-not-copy-or-log"}')
        paths = [config, self.root / "proxy-key", auth, self.models]
        before = [p.read_bytes() for p in paths]
        result = self.run_setup()
        self.assertEqual([p.read_bytes() for p in paths], before)
        self.assertNotIn("do-not-copy-or-log", result.stdout + result.stderr)
        self.assertFalse((self.root / "backups").exists())

    def test_other_pi_providers_are_preserved_and_backed_up_privately(self):
        original = {"providers": {"gpt": {"apiKey": "fake-existing-value"}}, "other": 42}
        self.models.parent.mkdir(parents=True)
        self.models.write_text(json.dumps(original))
        before = self.models.read_bytes()
        result = self.run_setup()
        updated = json.loads(self.models.read_text())
        self.assertEqual(updated["providers"]["gpt"], original["providers"]["gpt"])
        self.assertEqual(updated["other"], 42)
        backups = list((self.root / "backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)
        self.assertNotIn("fake-existing-value", result.stdout + result.stderr)

    def test_conflicting_provider_is_not_overwritten(self):
        self.models.parent.mkdir(parents=True)
        self.models.write_text('{"providers":{"claude-pro-proxy":{"custom":true}}}')
        before = self.models.read_bytes()
        self.run_setup(success=False)
        self.assertEqual(self.models.read_bytes(), before)
        self.assertFalse(self.root.exists())

    def test_refresh_reuses_key_and_backs_up_previous_config(self):
        self.run_setup()
        config = self.root / "config.native.yaml"
        original = config.read_bytes()
        key = (self.root / "proxy-key").read_bytes()
        template = self.managed / "config.template.yaml"
        template.write_text(template.read_text().replace("port: 8317", "port: 8318"))
        self.run_setup("--refresh-config")
        self.assertIn("port: 8318", config.read_text())
        self.assertEqual((self.root / "proxy-key").read_bytes(), key)
        backups = list((self.root / "backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)

    def test_symlinked_key_is_rejected_without_touching_destination(self):
        self.root.mkdir(parents=True)
        destination = self.home / "unrelated-file"
        destination.write_text("leave-me-alone")
        (self.root / "proxy-key").symlink_to(destination)
        self.run_setup(success=False)
        self.assertEqual(destination.read_text(), "leave-me-alone")
        self.assertFalse((self.root / "config.native.yaml").exists())

    def test_invalid_models_json_does_not_leak_input_or_create_state(self):
        self.models.parent.mkdir(parents=True)
        self.models.write_text("fake-sensitive-content not json")
        result = self.run_setup(success=False)
        self.assertNotIn("fake-sensitive-content", result.stdout + result.stderr)
        self.assertFalse(self.root.exists())

    def test_config_without_local_key_does_not_get_a_new_incompatible_key(self):
        self.root.mkdir(parents=True)
        config = self.root / "config.native.yaml"
        config.write_text("existing-config")
        self.run_setup(success=False)
        self.assertEqual(config.read_text(), "existing-config")
        self.assertFalse((self.root / "proxy-key").exists())

    def test_world_readable_key_is_rejected(self):
        self.run_setup()
        (self.root / "proxy-key").chmod(0o644)
        self.run_setup(success=False)


if __name__ == "__main__":
    unittest.main()
