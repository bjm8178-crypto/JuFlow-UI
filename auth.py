"""auth.py - stdlib-only server-side auth for Juki (PBKDF2 + DB-backed sessions)."""
import hashlib, hmac, json, os, secrets, sqlite3, time, re
from contextlib import contextmanager
from urllib.parse import unquote, urlsplit, quote

DB_PATH = os.environ.get("JUFLOW_AUTH_DB", ".juflow-auth.sqlite3")
COOKIE = "juflow_session"
SESSION_TTL = 60 * 60 * 12          # 12 hours
PBKDF2_ITER = 240_000
MAX_FAILS, LOCK_SECONDS = 5, 300    # lock account 5 min after 5 bad logins
ALLOW_SIGNUP = os.environ.get("JUFLOW_ALLOW_SIGNUP") == "1"
SECURE_COOKIE = os.environ.get("JUFLOW_HTTPS") == "1"   # set when served over HTTPS

# Paths reachable without a session. ADD the cashier endpoint path here (it has its own auth).
PUBLIC_PATHS = {
    "/login.html", "/signup.html", "/styles.css", "/app.js", "/auth-guard.js", "/favicon.ico",
    "/api/auth/login", "/api/auth/signup", "/api/auth/me", "/api/auth/logout",
    "/api/cashier/sales",
}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@contextmanager
def _db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        with c:
            yield c
    finally:
        c.close()


def init_auth():
    with _db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'admin',
          pw_salt BLOB NOT NULL, pw_hash BLOB NOT NULL,
          failed INTEGER NOT NULL DEFAULT 0,
          locked_until REAL NOT NULL DEFAULT 0,
          created_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          expires_at REAL NOT NULL);
        """)


def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITER)


def _th(token):  # only the hash of the session token is stored
    return hashlib.sha256(token.encode()).hexdigest()


def signup(email, password, name=""):
    if not isinstance(email, str):
        return None, "invalid_email"
    if not isinstance(password, str) or not isinstance(name, str):
        return None, "invalid_input"
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        return None, "invalid_email"
    if len(password or "") < 8:
        return None, "password_too_short"
    with _db() as c:
        c.execute("BEGIN IMMEDIATE")
        first = c.execute("SELECT COUNT(*) n FROM users").fetchone()["n"] == 0
        if not first and not ALLOW_SIGNUP:
            return None, "signup_disabled"      # only the first account is open by default
        salt = secrets.token_bytes(16)
        try:
            c.execute("INSERT INTO users(email,name,role,pw_salt,pw_hash,created_at) VALUES(?,?,?,?,?,?)",
                      (email, name.strip()[:80], "admin", salt, _hash(password, salt), time.time()))
        except sqlite3.IntegrityError:
            return None, "email_taken"
    return email, None


def login(email, password):
    """Returns (token, error)."""
    if not isinstance(email, str) or not isinstance(password, str):
        return None, "invalid_credentials"
    email = email.strip().lower()
    with _db() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if u is None:                                   # burn time, no user enumeration
            _hash(password or "", b"0" * 16)
            return None, "invalid_credentials"
        if u["locked_until"] > time.time():
            return None, "locked"
        if not hmac.compare_digest(_hash(password or "", u["pw_salt"]), u["pw_hash"]):
            fails = u["failed"] + 1
            lock = time.time() + LOCK_SECONDS if fails >= MAX_FAILS else 0
            c.execute("UPDATE users SET failed=?, locked_until=? WHERE id=?",
                      (0 if lock else fails, lock, u["id"]))
            return None, "invalid_credentials"
        c.execute("UPDATE users SET failed=0, locked_until=0 WHERE id=?", (u["id"],))
        token = secrets.token_urlsafe(32)
        c.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (_th(token), u["id"], time.time() + SESSION_TTL))
        return token, None


def logout(token):
    with _db() as c:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (_th(token),))


def _token_from(handler):
    for part in (handler.headers.get("Cookie") or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return None


def current_user(handler):
    t = _token_from(handler)
    if not t:
        return None
    with _db() as c:
        r = c.execute("""SELECT u.id,u.email,u.name,u.role FROM sessions s
                         JOIN users u ON u.id=s.user_id
                         WHERE s.token_hash=? AND s.expires_at>?""", (_th(t), time.time())).fetchone()
    return dict(r) if r else None


def _json(h, status, obj, headers=()):
    body = json.dumps(obj).encode()
    h.send_response(status)
    h.send_header("Content-Type", "application/json")
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    for k, v in headers:
        h.send_header(k, v)
    h.end_headers()
    if getattr(h, "command", None) != "HEAD":
        h.wfile.write(body)
    return True


def _body(h):
    lengths = h.headers.get_all("Content-Length") if hasattr(h.headers, "get_all") else None
    if h.headers.get("Transfer-Encoding") or (lengths and len(lengths) != 1):
        raise ValueError("invalid_body")
    raw_length = h.headers.get("Content-Length", "0")
    if not re.fullmatch(r"[0-9]+", raw_length):
        raise ValueError("invalid_body")
    n = int(raw_length)
    if n > 10_000:
        raise ValueError("invalid_body")
    raw = h.rfile.read(n)
    if len(raw) != n:
        raise ValueError("invalid_body")
    try:
        body = json.loads(raw or b"{}")
    except (ValueError, UnicodeError):
        raise ValueError("invalid_body") from None
    if not isinstance(body, dict):
        raise ValueError("invalid_body")
    for key in ("email", "password", "name"):
        if key in body and not isinstance(body[key], str):
            raise ValueError("invalid_body")
    return body


def _cookie(token, max_age):
    c = f"{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"
    return ("Set-Cookie", c + ("; Secure" if SECURE_COOKIE else ""))


def handle(h, method, path):
    """Call at top of do_GET/do_POST. Returns True if the request was fully handled."""
    route = path.split("?")[0]
    if not route.startswith("/api/auth/"):
        return False
    if method in ("GET", "HEAD") and route == "/api/auth/me":
        u = current_user(h)
        return _json(h, 200, {"user": u}) if u else _json(h, 401, {"error": "not_authenticated"})
    if method != "POST":
        return _json(h, 405, {"error": "method_not_allowed"})
    try:
        b = _body(h)
    except ValueError:
        h.close_connection = True
        return _json(h, 400, {"error": "invalid_body"})
    if route == "/api/auth/login":
        token, err = login(b.get("email"), b.get("password"))
        if err:
            return _json(h, 429 if err == "locked" else 401, {"error": err})
        return _json(h, 200, {"ok": True}, [_cookie(token, SESSION_TTL)])
    if route == "/api/auth/signup":
        email, err = signup(b.get("email"), b.get("password"), b.get("name", ""))
        if err:
            return _json(h, 403 if err == "signup_disabled" else 400, {"error": err})
        return _json(h, 201, {"ok": True})
    if route == "/api/auth/logout":
        t = _token_from(h)
        if t:
            logout(t)
        return _json(h, 200, {"ok": True}, [_cookie("", 0)])
    return _json(h, 404, {"error": "not_found"})


def gate(h, method, path):
    """Call after handle(). Returns True if the request was BLOCKED (response already sent)."""
    route = path.split("?")[0]
    # Reject private files before redirecting, including URL-encoded names.
    decoded = unquote(urlsplit(path).path).replace("\\", "/")
    parts = decoded.split("/")
    if any(p.startswith(".") for p in parts if p) or decoded.lower().endswith((".py", ".sqlite3")):
        return _json(h, 404, {"error": "not_found"})
    if route in PUBLIC_PATHS or current_user(h):
        return False
    if route.startswith("/api/"):
        return _json(h, 401, {"error": "not_authenticated"})
    h.send_response(302)
    h.send_header("Location", "/login.html?next=" + quote(route, safe="/"))
    h.send_header("Content-Length", "0")
    h.end_headers()
    return True
