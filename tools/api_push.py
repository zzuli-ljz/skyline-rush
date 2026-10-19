import base64, json, os, sys, urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
REPO = "zzuli-ljz/skyline-rush"
BRANCH = "main"
MSG = "fix: 消除隐形墙式误判碰撞"
FILES = sys.argv[1:]

def api(path, method="GET", data=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())

root = os.path.dirname(os.path.abspath(__file__)) + "/.."
for rel in FILES:
    with open(os.path.join(root, rel), "rb") as f:
        content = base64.b64encode(f.read()).decode()
    sha = None
    try:
        sha = api(f"contents/{rel}?ref={BRANCH}")["sha"]
    except Exception as e:
        print("no sha", rel, e)
    payload = {"message": MSG, "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    res = api(f"contents/{rel}", "PUT", payload)
    print("OK", rel, "->", res["commit"]["sha"][:7])
