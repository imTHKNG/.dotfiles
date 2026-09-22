#!/usr/bin/env python3

import importlib.machinery
import io
from pathlib import Path
import sys
import tempfile
import textwrap
import unittest


SCRIPT = (
    Path(__file__).parents[1]
    / "home"
    / "dot_local"
    / "bin"
    / "executable_fuji-ingest"
)
fuji_ingest = importlib.machinery.SourceFileLoader(
    "fuji_ingest", str(SCRIPT)
).load_module()


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


if __name__ == "__main__":
    unittest.main()
