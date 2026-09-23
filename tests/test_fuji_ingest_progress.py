#!/usr/bin/env python3

import argparse
from contextlib import redirect_stdout
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch


SCRIPT = (
    Path(__file__).parents[1]
    / "home"
    / "dot_local"
    / "bin"
    / "executable_fuji-ingest"
)
sys.dont_write_bytecode = True
loader = importlib.machinery.SourceFileLoader("fuji_ingest", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
assert spec is not None
fuji_ingest = importlib.util.module_from_spec(spec)
loader.exec_module(fuji_ingest)


class TtyBuffer(io.StringIO):
    def isatty(self) -> bool:
        return True


class DownloadProgressTest(unittest.TestCase):
    def test_child_progress_is_replaced_by_one_global_progress_line(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            fake_download = directory / "fake-download.py"
            fake_download.write_text(
                textwrap.dedent(
                    """\
                    import pathlib
                    import time

                    for index in range(1, 4):
                        name = f"DSCF{index:04}.JPG"
                        print(f"child downloading {name}", flush=True)
                        pathlib.Path(name).write_bytes(bytes([index]) * 1024)
                        time.sleep(0.25)
                    """
                ),
                encoding="utf-8",
            )
            inventory = [
                {
                    "folder": "/store_00010001/DCIM/100_FUJI",
                    "name": f"DSCF{index:04}.JPG",
                    "size_kib": 1,
                }
                for index in range(1, 4)
            ]
            output = TtyBuffer()

            returncode, child_output = fuji_ingest.download_camera_files(
                [sys.executable, str(fake_download)],
                directory,
                inventory,
                output,
            )

            self.assertEqual(returncode, 0)
            self.assertIn("child downloading DSCF0001.JPG", child_output)
            self.assertNotIn("child downloading", output.getvalue())
            self.assertEqual(output.getvalue().count("\n"), 1)
            self.assertIn("Downloading: 3/3 files (100%)", output.getvalue())


class IngestDirectoryTest(unittest.TestCase):
    def run_ingest(self, root: Path, *, resume: bool = False, dry_run: bool = False) -> str:
        inventory = [{"folder": "/camera", "name": "DSCF0001.JPG", "size_kib": 1}]
        args = argparse.Namespace(
            slug="test-batch",
            date="2026-09-23",
            root=root,
            dry_run=dry_run,
            resume=resume,
        )
        output = io.StringIO()
        with (
            patch.object(fuji_ingest, "parse_args", return_value=args),
            patch.object(fuji_ingest, "detect_camera", return_value="Fuji"),
            patch.object(fuji_ingest, "camera_inventory", return_value=inventory),
            patch.object(fuji_ingest.shutil, "which", return_value="/usr/bin/gphoto2"),
            redirect_stdout(output),
        ):
            if dry_run:
                self.assertEqual(fuji_ingest.main(), 0)
            elif resume:
                with (
                    patch.object(fuji_ingest, "download_camera_files", return_value=(0, "")),
                    patch.object(fuji_ingest, "verify", return_value=[]),
                    patch.object(fuji_ingest, "write_checksums"),
                ):
                    self.assertEqual(fuji_ingest.main(), 0)
            else:
                with self.assertRaisesRegex(fuji_ingest.IngestError, "destination already exists"):
                    fuji_ingest.main()
        return output.getvalue()

    def test_new_batches_use_year_at_root_and_separate_temporary_exports(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = self.run_ingest(root, dry_run=True)
            self.assertIn(str(root / "2026/2026-09-23-test-batch"), output)
            self.assertIn(str(root / "_exported/2026/2026-09-23-test-batch"), output)
            self.assertFalse((root / "2026").exists())

    def test_existing_legacy_batch_blocks_accidental_duplicate_ingest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "imported/2026/2026-09-23-test-batch").mkdir(parents=True)
            self.run_ingest(root)
            self.assertFalse((root / "2026").exists())

    def test_resume_of_incomplete_legacy_batch_stays_at_original_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_batch = root / "imported/2026/2026-09-23-test-batch"
            old_batch.mkdir(parents=True)
            (old_batch / ".fuji-ingest.json").write_text(
                json.dumps({
                    "status": "incomplete",
                    "inventory": [{"folder": "/camera", "name": "DSCF0001.JPG", "size_kib": 1}],
                }),
                encoding="utf-8",
            )
            output = self.run_ingest(root, resume=True)
            self.assertIn(f"Imported destination: {old_batch}", output)
            self.assertIn(str(root / "exported/2026/2026-09-23-test-batch"), output)
            self.assertFalse((root / "2026").exists())


if __name__ == "__main__":
    unittest.main()
