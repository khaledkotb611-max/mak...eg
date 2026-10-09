import os
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

origin = urlsplit(os.environ["SITE_ORIGIN"])
request = Request("http://127.0.0.1:8000/api/health", headers={
    "Host": origin.netloc, "X-Forwarded-Proto": "https",
})
with urlopen(request, timeout=10) as response:
    if response.status != 200:
        raise SystemExit(1)
