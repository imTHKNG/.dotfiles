import copy
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

mode = os.environ["SYNC_SETUP_MODE"]
folder_id = os.environ["SYNC_FOLDER_ID"]
folder_label = os.environ["SYNC_FOLDER_LABEL"]
folder_path = os.path.abspath(os.path.expanduser(os.environ["SYNC_FOLDER_PATH"]))
expected_names = os.environ["SYNC_EXPECTED_DEVICES"].split(",")
max_age = os.environ["SYNC_MAX_AGE"]

config_candidates = [
    Path.home() / ".local/state/syncthing/config.xml",
    Path.home() / ".config/syncthing/config.xml",
]
config_path = next((path for path in config_candidates if path.is_file()), None)
if config_path is None:
    sys.exit("error: Syncthing config.xml was not found after startup.")

root = ET.parse(config_path).getroot()
gui = root.find("gui")
if gui is None:
    sys.exit("error: Syncthing GUI/API configuration is missing.")

api_key = (gui.findtext("apikey") or "").strip()
address = (gui.findtext("address") or "127.0.0.1:8384").strip()
if not api_key:
    sys.exit("error: Syncthing local API key is missing.")

if address.startswith("0.0.0.0:"):
    address = "127.0.0.1:" + address.rsplit(":", 1)[1]
elif address.startswith("[::]:"):
    address = "127.0.0.1:" + address.rsplit(":", 1)[1]
elif address.startswith(":"):
    address = "127.0.0.1" + address

scheme = "https" if gui.get("tls", "false").lower() == "true" else "http"
base_url = f"{scheme}://{address}"
ssl_context = ssl._create_unverified_context() if scheme == "https" else None
headers = {"X-API-Key": api_key, "Content-Type": "application/json"}


def request(method, endpoint, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base_url + endpoint, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl_context) as response:
            data = response.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        sys.exit(f"error: Syncthing API {method} {endpoint} failed ({exc.code}): {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"error: Could not reach the local Syncthing API: {exc.reason}")


config = request("GET", "/rest/config")
devices = config.get("devices", [])
devices_by_name = {device.get("name"): device for device in devices}
missing = [name for name in expected_names if name not in devices_by_name]
if missing:
    known = ", ".join(sorted(name for name in devices_by_name if name)) or "none"
    sys.exit(
        "error: Missing paired Syncthing device(s): "
        + ", ".join(missing)
        + f". Known device names: {known}. Pair them first."
    )

existing = next((folder for folder in config.get("folders", []) if folder.get("id") == folder_id), None)
if existing and os.path.abspath(os.path.expanduser(existing.get("path", ""))) != folder_path:
    sys.exit(
        f"error: Folder ID '{folder_id}' already points to {existing.get('path')!r}; "
        f"refusing to replace it with {folder_path!r}."
    )

if existing:
    folder = copy.deepcopy(existing)
else:
    folder = copy.deepcopy(config.get("defaults", {}).get("folder", {}))

folder.update(
    {
        "id": folder_id,
        "label": folder_label,
        "path": folder_path,
        "type": "sendreceive",
        "rescanIntervalS": 3600,
        "fsWatcherEnabled": True,
        "fsWatcherDelayS": 10,
        "ignorePerms": False,
        "paused": False,
        "devices": [
            {"deviceID": devices_by_name[name]["deviceID"], "introducedBy": ""}
            for name in expected_names
        ],
        "versioning": {
            "type": "staggered",
            "params": {"maxAge": max_age},
            "cleanupIntervalS": 3600,
            "fsPath": "",
            "fsType": "basic",
        },
    }
)

print(f"Host: {os.uname().nodename}")
print(f"Mode: {mode}")
print(f"Folder: {folder_id} -> {folder_path}")
print("Devices: " + ", ".join(expected_names))
print(f"Versioning: staggered, {int(max_age) // 86400} days")

if mode == "dry-run":
    print("No changes made. Re-run with --apply to configure this host.")
    raise SystemExit(0)

endpoint = "/rest/config/folders/" + urllib.parse.quote(folder_id, safe="")
request("PUT", endpoint, folder)
request("POST", "/rest/db/scan?folder=" + urllib.parse.quote(folder_id, safe=""))

verified = request("GET", endpoint)
verified_ids = {item.get("deviceID") for item in verified.get("devices", [])}
expected_ids = {devices_by_name[name]["deviceID"] for name in expected_names}
checks = {
    "path": os.path.abspath(os.path.expanduser(verified.get("path", ""))) == folder_path,
    "type": verified.get("type") == "sendreceive",
    "watcher": verified.get("fsWatcherEnabled") is True,
    "devices": expected_ids <= verified_ids,
    "versioning": verified.get("versioning", {}).get("type") == "staggered",
    "maxAge": verified.get("versioning", {}).get("params", {}).get("maxAge") == max_age,
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    sys.exit("error: Configuration verification failed for: " + ", ".join(failed))

print("Verified: ~/sync is configured and shared with all three devices.")
