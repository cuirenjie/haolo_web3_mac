import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import support_knowledge as builder

ROOT = Path(__file__).resolve().parents[1]


class ProductKnowledgeTests(unittest.TestCase):
    def test_generated_runtime_and_sources_are_current(self):
        bundle = builder.build(ROOT)
        builder.emit(ROOT, bundle, check=True)
        self.assertEqual(set(bundle["source_hashes"]), {p for f in bundle["contract"]["features"] for p in f["sources"]})
        self.assertEqual(bundle["contract_id"], builder.digest(bundle["contract"]))

    def test_unknown_and_conflicting_adapter_versions_are_not_enabled(self):
        bundle = builder.build(ROOT)
        feature = copy.deepcopy(bundle["contract"]["features"][0])
        feature["status"] = "approved"; feature["actions"] = {"set_theme": 1}
        other = copy.deepcopy(feature); other["actions"] = {"set_theme": 2}
        bundle["contract"]["features"] = [feature, other]
        with self.assertRaises(ValueError): builder.runtime(bundle)
        other["status"] = "pending"
        self.assertEqual(builder.runtime(bundle)["action_versions"], {"set_theme": 1})

    def test_source_path_traversal_is_rejected(self):
        for path in ["../secrets", "/secrets", "C:/secrets", "..\\secrets"]:
            with self.assertRaises(ValueError): builder.read(ROOT, path)

    def test_node_and_python_builders_produce_identical_bundles(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "bundle.json"
            subprocess.run(["node", str(ROOT/"tools/prepare-support.mjs"), "--check", "--output", str(out)],check=True,capture_output=True)
            self.assertEqual(json.loads(out.read_text(encoding="utf-8")),builder.build(ROOT))


if __name__ == "__main__":
    unittest.main()
