"""Python access to the SentimentMarker scoring engine. There is no Python scorer: this sends one batch
request to the JS engine (tools/score-cli.js, which runs sentiment-core.js under Node) and returns its
answer, so offline scores are exactly the browser's. One Node process per call, however many jobs.

    import sm_engine
    res = sm_engine.score([{"profile": "finance", "sentences": ["Not strong."]}])
    res[0]["sentences"][0]["score"]

Set NODE to choose the Node binary (default: node on PATH). Request / response shapes: tools/score-cli.js.
"""
import json, os, shutil, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CLI = os.path.join(ROOT, "tools", "score-cli.js")


class EngineError(RuntimeError):
    pass


def node_binary():
    node = os.environ.get("NODE") or shutil.which("node")
    if not node:
        raise EngineError("Node.js is required for scoring (set NODE or put node on PATH)")
    return node


def score(jobs):
    """jobs: list of {"profile", "sentences": [...]} or {"profile", "title", "paragraphs": [...]}; returns the results list."""
    r = subprocess.run([node_binary(), CLI], input=json.dumps({"jobs": jobs}, ensure_ascii=False).encode("utf-8"),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT)
    if r.returncode != 0:
        raise EngineError(r.stderr.decode("utf-8", "replace").strip() or f"score-cli exited with {r.returncode}")
    return json.loads(r.stdout.decode("utf-8"))["results"]


def score_sentences(texts, profile="general"):
    return score([{"profile": profile, "sentences": list(texts)}])[0]["sentences"]


def score_document(paragraphs, title, profile="general"):
    return score([{"profile": profile, "title": title, "paragraphs": paragraphs}])[0]["doc"]
