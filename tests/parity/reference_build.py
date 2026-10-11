"""Run the original Python tool (reference/python-tool/kmvt_sop.py) against the fake Notion API.
Usage: python3 tests/parity/reference_build.py <kmvt_sop.py> <api-base> <token> <page-id> <out-dir>
Called by tests/parity/run.js; not meant to be run by hand."""
import importlib.util
import json
import os
import sys
import urllib.request

ref, base, token, page_id, out = sys.argv[1:6]
spec = importlib.util.spec_from_file_location("kmvt_sop", ref)
K = importlib.util.module_from_spec(spec)
spec.loader.exec_module(K)


def req(self, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + "/" + path.lstrip("/"), data=data, method=method, headers={
        "Authorization": "Bearer " + token, "Notion-Version": K.NOTION_VERSION, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode())


K.Notion.req = req
os.environ["NOTION_TOKEN"] = token
sys.argv = ["kmvt_sop.py", page_id, "-o", out]
K.main()
